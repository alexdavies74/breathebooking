import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  clamp,
  formatDayLabel,
  formatTime,
  roundToStep,
  startOfToday,
  toDayKey,
} from "../domain/date";
import type {
  BookingDraft,
  ProviderEditableKind,
  ProviderRangeDraft,
  Role,
  WeekBlock,
} from "../domain/types";

interface ProviderEditConfig {
  mode: ProviderEditableKind;
  draft?: ProviderRangeDraft | null;
  onCreateDraft(dayStart: number, startMinutes: number): void;
  onEditBlock(block: WeekBlock): void;
  onChangeDraft(next: ProviderRangeDraft): void;
  onSaveDraft(): void;
  onDeleteDraft(): void;
}

interface WeekViewProps {
  role: Role;
  blocks: WeekBlock[];
  selectedDraft?: BookingDraft | null;
  onSelectBlock?: (block: WeekBlock) => void;
  onSelectSession?: (block: WeekBlock) => void;
  horizonDays?: number;
  onExtendHorizon?: (nextHorizonDays: number) => void;
  providerEdit?: ProviderEditConfig;
}

const DAY_START_MINUTES = 6 * 60;
const DAY_END_MINUTES = 22 * 60;
const DAY_RANGE = DAY_END_MINUTES - DAY_START_MINUTES;
const HOUR_STEP = 60;
const RANGE_STEP = 30;
const MIN_RANGE_MINUTES = 30;

type DragMode = "move" | "resize-start" | "resize-end";

interface DragState {
  mode: DragMode;
  canvasTop: number;
  canvasHeight: number;
  initialStartMinutes: number;
  initialEndMinutes: number;
  pointerOffsetMinutes: number;
}

function formatHourLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const suffix = hours >= 12 ? "PM" : "AM";
  const normalized = hours % 12 || 12;
  return `${normalized} ${suffix}`;
}

function minutesIntoDay(timestamp: number): number {
  const date = new Date(timestamp);
  return date.getHours() * 60 + date.getMinutes();
}

function blockPosition(block: { startsAt: number; endsAt: number }) {
  const start = clamp(minutesIntoDay(block.startsAt), DAY_START_MINUTES, DAY_END_MINUTES);
  const end = clamp(minutesIntoDay(block.endsAt), DAY_START_MINUTES, DAY_END_MINUTES);
  return {
    top: `${((start - DAY_START_MINUTES) / DAY_RANGE) * 100}%`,
    height: `${Math.max(((end - start) / DAY_RANGE) * 100, 6)}%`,
  };
}

function draftPosition(draft: ProviderRangeDraft) {
  const start = clamp(draft.startMinutes, DAY_START_MINUTES, DAY_END_MINUTES);
  const end = clamp(draft.endMinutes, DAY_START_MINUTES, DAY_END_MINUTES);
  return {
    top: `${((start - DAY_START_MINUTES) / DAY_RANGE) * 100}%`,
    height: `${Math.max(((end - start) / DAY_RANGE) * 100, 6)}%`,
  };
}

function resolveAction(block: WeekBlock, props: WeekViewProps) {
  if (block.state === "booked-own") {
    props.onSelectSession?.(block);
    return;
  }

  if (block.state === "available" || block.state === "maybe") {
    props.onSelectBlock?.(block);
  }
}

function labelForProviderKind(kind: ProviderEditableKind, isNew: boolean) {
  if (kind === "availability") {
    return isNew ? "New availability" : "Availability";
  }

  return isNew ? "New personal block" : "Personal block";
}

function isEditingOccurrence(block: WeekBlock, draft?: ProviderRangeDraft | null) {
  return (
    draft !== undefined &&
    draft !== null &&
    block.sourceKind === draft.sourceKind &&
    block.sourceId === draft.sourceId &&
    block.dayKey === draft.dayKey
  );
}

function positionToMinutes(clientY: number, canvasTop: number, canvasHeight: number) {
  const relativeY = clamp(clientY - canvasTop, 0, canvasHeight);
  const rawMinutes = DAY_START_MINUTES + (relativeY / canvasHeight) * DAY_RANGE;
  return clamp(roundToStep(rawMinutes, RANGE_STEP), DAY_START_MINUTES, DAY_END_MINUTES);
}

export function WeekView({
  role,
  blocks,
  selectedDraft,
  onSelectBlock,
  onSelectSession,
  horizonDays = 7,
  onExtendHorizon,
  providerEdit,
}: WeekViewProps) {
  const requestRef = useRef(horizonDays);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const today = startOfToday();
  const dayKeys = Array.from({ length: horizonDays }, (_, index) => toDayKey(today + index * 86400000));
  const hourMarkers = Array.from(
    { length: Math.floor(DAY_RANGE / HOUR_STEP) + 1 },
    (_, index) => DAY_START_MINUTES + index * HOUR_STEP,
  );
  const grouped = new Map<string, WeekBlock[]>();

  dayKeys.forEach((dayKey) => grouped.set(dayKey, []));
  blocks.forEach((block) => {
    grouped.get(block.dayKey)?.push(block);
  });

  useEffect(() => {
    requestRef.current = horizonDays;
  }, [horizonDays]);

  useEffect(() => {
    if (!dragState || !providerEdit || !providerEdit.draft) {
      return;
    }

    const currentDrag = dragState;
    const editConfig = providerEdit;
    const currentDraft = editConfig.draft!;

    function handleMouseMove(event: MouseEvent) {
      const pointerMinutes = positionToMinutes(event.clientY, currentDrag.canvasTop, currentDrag.canvasHeight);
      const duration = currentDrag.initialEndMinutes - currentDrag.initialStartMinutes;

      if (currentDrag.mode === "move") {
        const unclampedStart = pointerMinutes - currentDrag.pointerOffsetMinutes;
        const nextStart = clamp(
          roundToStep(unclampedStart, RANGE_STEP),
          DAY_START_MINUTES,
          DAY_END_MINUTES - duration,
        );
        editConfig.onChangeDraft({
          ...currentDraft,
          startMinutes: nextStart,
          endMinutes: nextStart + duration,
        });
        return;
      }

      if (currentDrag.mode === "resize-start") {
        const nextStart = clamp(
          pointerMinutes,
          DAY_START_MINUTES,
          currentDrag.initialEndMinutes - MIN_RANGE_MINUTES,
        );
        editConfig.onChangeDraft({
          ...currentDraft,
          startMinutes: nextStart,
        });
        return;
      }

      const nextEnd = clamp(
        pointerMinutes,
        currentDrag.initialStartMinutes + MIN_RANGE_MINUTES,
        DAY_END_MINUTES,
      );
      editConfig.onChangeDraft({
        ...currentDraft,
        endMinutes: nextEnd,
      });
    }

    function handleMouseUp() {
      setDragState(null);
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragState, providerEdit]);

  function maybeExtendHorizon(container: HTMLDivElement) {
    if (!onExtendHorizon) {
      return;
    }

    const remaining = container.scrollWidth - container.clientWidth - container.scrollLeft;
    if (remaining > 280) {
      return;
    }

    const nextHorizonDays = horizonDays + 7;
    if (requestRef.current >= nextHorizonDays) {
      return;
    }

    requestRef.current = nextHorizonDays;
    onExtendHorizon(nextHorizonDays);
  }

  function startDraftDrag(
    event: ReactMouseEvent<HTMLDivElement | HTMLButtonElement>,
    mode: DragMode,
    draft: ProviderRangeDraft,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const canvas = event.currentTarget.closest(".day-column__canvas") as HTMLDivElement | null;
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const pointerMinutes = positionToMinutes(event.clientY, rect.top, rect.height);
    setDragState({
      mode,
      canvasTop: rect.top,
      canvasHeight: rect.height,
      initialStartMinutes: draft.startMinutes,
      initialEndMinutes: draft.endMinutes,
      pointerOffsetMinutes:
        mode === "move" ? pointerMinutes - draft.startMinutes : 0,
    });
  }

  return (
    <div
      className="week-view"
      onScroll={(event) => maybeExtendHorizon(event.currentTarget)}
    >
      <div className="time-axis">
        <div className="time-axis__header" />
        <div className="time-axis__canvas">
          {hourMarkers.map((minutes) => (
            <div
              className="time-axis__tick"
              key={minutes}
              style={{ top: `${((minutes - DAY_START_MINUTES) / DAY_RANGE) * 100}%` }}
            >
              <span>{formatHourLabel(minutes)}</span>
            </div>
          ))}
        </div>
      </div>
      {dayKeys.map((dayKey, index) => {
        const dayStart = today + index * 86400000;
        const dayBlocks = (grouped.get(dayKey) ?? []).sort((left, right) => left.startsAt - right.startsAt);
        const draftForDay = selectedDraft?.dayKey === dayKey ? selectedDraft : null;
        const editConfig = providerEdit;
        const providerDraft = editConfig?.draft?.dayKey === dayKey ? editConfig.draft : null;

        return (
          <section className="day-column" key={dayKey}>
            <header className="day-column__header">
              <span className="eyebrow">{role}</span>
              <strong>{formatDayLabel(dayStart)}</strong>
            </header>
            <div
              className={`day-column__canvas${providerEdit ? " day-column__canvas--editable" : ""}`}
              onClick={(event) => {
                if (!editConfig) {
                  return;
                }

                if (event.target instanceof Element && event.target.closest(".week-block")) {
                  return;
                }

                const rect = event.currentTarget.getBoundingClientRect();
                const startMinutes = positionToMinutes(event.clientY, rect.top, rect.height);
                editConfig.onCreateDraft(dayStart, startMinutes);
              }}
            >
              {hourMarkers.map((minutes) => (
                <div
                  className="day-column__hour-line"
                  key={minutes}
                  style={{ top: `${((minutes - DAY_START_MINUTES) / DAY_RANGE) * 100}%` }}
                />
              ))}
              {dayBlocks.map((block) => {
                const providerEditable =
                  editConfig !== undefined && block.sourceKind === editConfig.mode;
                if (isEditingOccurrence(block, editConfig?.draft)) {
                  return null;
                }

                return (
                  <button
                    key={block.id}
                    className={`week-block week-block--${block.state}${providerEditable ? " week-block--editable" : ""}`}
                    style={blockPosition(block)}
                    onClick={() => {
                      if (providerEditable && editConfig) {
                        editConfig.onEditBlock(block);
                        return;
                      }

                      resolveAction(block, {
                        role,
                        blocks,
                        selectedDraft,
                        onSelectBlock,
                        onSelectSession,
                        horizonDays,
                      });
                    }}
                    type="button"
                    disabled={!block.interactive}
                  >
                    {providerEditable ? <span className="week-block__drag-handle week-block__drag-handle--top" /> : null}
                    <span>{block.label ?? "Unavailable"}</span>
                    <small>
                      {formatTime(block.earliestStartAt ?? block.startsAt)}
                      {" - "}
                      {formatTime(block.endsAt)}
                    </small>
                    {providerEditable ? <span className="week-block__drag-handle week-block__drag-handle--bottom" /> : null}
                  </button>
                );
              })}

              {draftForDay ? (
                <div className="week-block week-block--draft" style={blockPosition(draftForDay)}>
                  <span>Draft booking</span>
                  <small>
                    {formatTime(draftForDay.earliestStartAt ?? draftForDay.guaranteedStartAt)}
                    {" - "}
                    {formatTime(draftForDay.endsAt)}
                  </small>
                </div>
              ) : null}

              {providerDraft && editConfig ? (
                <div
                  className={`week-block week-block--draft week-block--draft-${providerDraft.sourceKind}`}
                  style={draftPosition(providerDraft)}
                >
                  <button
                    aria-label="Resize start"
                    className="week-block__drag-handle week-block__drag-handle--top week-block__drag-handle--interactive"
                    onMouseDown={(event) => startDraftDrag(event, "resize-start", providerDraft)}
                    type="button"
                  />
                  <button
                    aria-label="Move range"
                    className="week-block__drag-surface"
                    onMouseDown={(event) => startDraftDrag(event, "move", providerDraft)}
                    type="button"
                  >
                    <span>{labelForProviderKind(providerDraft.sourceKind, providerDraft.isNew)}</span>
                    <small>
                      {formatTime(providerDraft.dayStart + providerDraft.startMinutes * 60 * 1000)}
                      {" - "}
                      {formatTime(providerDraft.dayStart + providerDraft.endMinutes * 60 * 1000)}
                    </small>
                  </button>
                  <div className="week-block__draft-actions">
                    <button className="button week-block__draft-save" onClick={() => editConfig.onSaveDraft()} type="button">
                      Save
                    </button>
                    {!providerDraft.isNew ? (
                      <button
                        className="button button--ghost week-block__draft-delete"
                        onClick={() => editConfig.onDeleteDraft()}
                        type="button"
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                  <button
                    aria-label="Resize end"
                    className="week-block__drag-handle week-block__drag-handle--bottom week-block__drag-handle--interactive"
                    onMouseDown={(event) => startDraftDrag(event, "resize-end", providerDraft)}
                    type="button"
                  />
                </div>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}
