import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  clamp,
  formatDayLabel,
  formatTime,
  minutesFromTimestamp,
  roundToStep,
  startOfToday,
  timestampFromDayAndMinutes,
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

interface BookingEditBounds {
  dayKey: string;
  dayStart: number;
  minStartMinutes: number;
  maxEndMinutes: number;
  minDurationMinutes: number;
}

interface BookingEditConfig {
  draft?: BookingDraft | null;
  bounds?: BookingEditBounds | null;
  onChangeDraft(next: BookingDraft): void;
  onConfirmDraft(): void;
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
  bookingEdit?: BookingEditConfig;
}

const DAY_START_MINUTES = 6 * 60;
const DAY_END_MINUTES = 22 * 60;
const DAY_RANGE = DAY_END_MINUTES - DAY_START_MINUTES;
const HOUR_STEP = 60;
const RANGE_STEP = 30;
const MIN_RANGE_MINUTES = 30;

type DragMode = "move" | "resize-start" | "resize-end";
type DragTarget = "provider" | "booking";

interface DragState {
  target: DragTarget;
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

function toBookingDraft(
  draft: BookingDraft,
  bounds: BookingEditBounds,
  startMinutes: number,
  endMinutes: number,
): BookingDraft {
  const guaranteedStartAt = timestampFromDayAndMinutes(bounds.dayStart, startMinutes);
  return {
    ...draft,
    startsAt: guaranteedStartAt,
    guaranteedStartAt,
    earliestStartAt: undefined,
    endsAt: timestampFromDayAndMinutes(bounds.dayStart, endMinutes),
    durationMinutes: endMinutes - startMinutes,
    dayKey: bounds.dayKey,
  };
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
  bookingEdit,
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
    if (!dragState) {
      return;
    }

    const currentDrag = dragState;

    function handlePointerMove(event: PointerEvent) {
      const pointerMinutes = positionToMinutes(event.clientY, currentDrag.canvasTop, currentDrag.canvasHeight);
      const duration = currentDrag.initialEndMinutes - currentDrag.initialStartMinutes;

      if (currentDrag.target === "provider") {
        if (!providerEdit?.draft) {
          return;
        }

        const currentDraft = providerEdit.draft;

        if (currentDrag.mode === "move") {
          const unclampedStart = pointerMinutes - currentDrag.pointerOffsetMinutes;
          const nextStart = clamp(
            roundToStep(unclampedStart, RANGE_STEP),
            DAY_START_MINUTES,
            DAY_END_MINUTES - duration,
          );
          providerEdit.onChangeDraft({
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
          providerEdit.onChangeDraft({
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
        providerEdit.onChangeDraft({
          ...currentDraft,
          endMinutes: nextEnd,
        });
        return;
      }

      if (!bookingEdit?.draft || !bookingEdit.bounds) {
        return;
      }

      const currentDraft = bookingEdit.draft;
      const bounds = bookingEdit.bounds;

      if (currentDrag.mode === "move") {
        const unclampedStart = pointerMinutes - currentDrag.pointerOffsetMinutes;
        const nextStart = clamp(
          roundToStep(unclampedStart, RANGE_STEP),
          bounds.minStartMinutes,
          bounds.maxEndMinutes - duration,
        );
        bookingEdit.onChangeDraft(toBookingDraft(currentDraft, bounds, nextStart, nextStart + duration));
        return;
      }

      if (currentDrag.mode === "resize-start") {
        const nextStart = clamp(
          pointerMinutes,
          bounds.minStartMinutes,
          currentDrag.initialEndMinutes - bounds.minDurationMinutes,
        );
        bookingEdit.onChangeDraft(toBookingDraft(currentDraft, bounds, nextStart, currentDrag.initialEndMinutes));
        return;
      }

      const nextEnd = clamp(
        pointerMinutes,
        currentDrag.initialStartMinutes + bounds.minDurationMinutes,
        bounds.maxEndMinutes,
      );
      bookingEdit.onChangeDraft(toBookingDraft(currentDraft, bounds, currentDrag.initialStartMinutes, nextEnd));
    }

    function handlePointerUp() {
      setDragState(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [bookingEdit, dragState, providerEdit]);

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
    event: ReactPointerEvent<HTMLDivElement | HTMLButtonElement>,
    target: DragTarget,
    mode: DragMode,
    startMinutes: number,
    endMinutes: number,
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
      target,
      mode,
      canvasTop: rect.top,
      canvasHeight: rect.height,
      initialStartMinutes: startMinutes,
      initialEndMinutes: endMinutes,
      pointerOffsetMinutes:
        mode === "move" ? pointerMinutes - startMinutes : 0,
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
        const bookingDraft = bookingEdit?.draft?.dayKey === dayKey ? bookingEdit.draft : null;
        const draftForDay = bookingDraft ?? (selectedDraft?.dayKey === dayKey ? selectedDraft : null);
        const bookingBounds = bookingEdit?.bounds?.dayKey === dayKey ? bookingEdit.bounds : null;
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
                  {bookingDraft && bookingBounds ? (
                    <>
                      <button
                        aria-label="Resize booking start"
                        className="week-block__drag-handle week-block__drag-handle--top week-block__drag-handle--interactive"
                        onPointerDown={(event) =>
                          startDraftDrag(
                            event,
                            "booking",
                            "resize-start",
                            minutesFromTimestamp(bookingDraft.guaranteedStartAt),
                            minutesFromTimestamp(bookingDraft.endsAt),
                          )
                        }
                        type="button"
                      />
                      <button
                        aria-label="Move booking"
                        className="week-block__drag-surface"
                        onPointerDown={(event) =>
                          startDraftDrag(
                            event,
                            "booking",
                            "move",
                            minutesFromTimestamp(bookingDraft.guaranteedStartAt),
                            minutesFromTimestamp(bookingDraft.endsAt),
                          )
                        }
                        type="button"
                      >
                        <span>Draft booking</span>
                        <small>
                          {formatTime(bookingDraft.earliestStartAt ?? bookingDraft.guaranteedStartAt)}
                          {" - "}
                          {formatTime(bookingDraft.endsAt)}
                        </small>
                      </button>
                      <div className="week-block__draft-actions">
                        <button className="button week-block__draft-save" onClick={() => bookingEdit.onConfirmDraft()} type="button">
                          Confirm
                        </button>
                      </div>
                      <button
                        aria-label="Resize booking end"
                        className="week-block__drag-handle week-block__drag-handle--bottom week-block__drag-handle--interactive"
                        onPointerDown={(event) =>
                          startDraftDrag(
                            event,
                            "booking",
                            "resize-end",
                            minutesFromTimestamp(bookingDraft.guaranteedStartAt),
                            minutesFromTimestamp(bookingDraft.endsAt),
                          )
                        }
                        type="button"
                      />
                    </>
                  ) : (
                    <>
                      <span>Draft booking</span>
                      <small>
                        {formatTime(draftForDay.earliestStartAt ?? draftForDay.guaranteedStartAt)}
                        {" - "}
                        {formatTime(draftForDay.endsAt)}
                      </small>
                      {bookingDraft ? (
                        <div className="week-block__draft-actions">
                          <button className="button week-block__draft-save" onClick={() => bookingEdit?.onConfirmDraft()} type="button">
                            Confirm
                          </button>
                        </div>
                      ) : null}
                    </>
                  )}
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
                    onPointerDown={(event) =>
                      startDraftDrag(event, "provider", "resize-start", providerDraft.startMinutes, providerDraft.endMinutes)
                    }
                    type="button"
                  />
                  <button
                    aria-label="Move range"
                    className="week-block__drag-surface"
                    onPointerDown={(event) =>
                      startDraftDrag(event, "provider", "move", providerDraft.startMinutes, providerDraft.endMinutes)
                    }
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
                    onPointerDown={(event) =>
                      startDraftDrag(event, "provider", "resize-end", providerDraft.startMinutes, providerDraft.endMinutes)
                    }
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
