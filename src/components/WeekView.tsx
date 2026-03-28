import { clamp, formatDayLabel, formatTime, startOfToday, toDayKey } from "../domain/date";
import type { BookingDraft, Role, WeekBlock } from "../domain/types";

interface WeekViewProps {
  role: Role;
  blocks: WeekBlock[];
  selectedDraft?: BookingDraft | null;
  onSelectBlock?: (block: WeekBlock) => void;
  onSelectSession?: (block: WeekBlock) => void;
  horizonDays?: number;
}

const DAY_START_MINUTES = 6 * 60;
const DAY_END_MINUTES = 22 * 60;
const DAY_RANGE = DAY_END_MINUTES - DAY_START_MINUTES;
const HOUR_STEP = 60;

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

function resolveAction(block: WeekBlock, props: WeekViewProps) {
  if (block.state === "booked-own") {
    props.onSelectSession?.(block);
    return;
  }

  if (block.state === "available" || block.state === "maybe") {
    props.onSelectBlock?.(block);
  }
}

export function WeekView({
  role,
  blocks,
  selectedDraft,
  onSelectBlock,
  onSelectSession,
  horizonDays = 7,
}: WeekViewProps) {
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

  return (
    <div className="week-view">
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

        return (
          <section className="day-column" key={dayKey}>
            <header className="day-column__header">
              <span className="eyebrow">{role}</span>
              <strong>{formatDayLabel(dayStart)}</strong>
            </header>
            <div className="day-column__canvas">
              {hourMarkers.map((minutes) => (
                <div
                  className="day-column__hour-line"
                  key={minutes}
                  style={{ top: `${((minutes - DAY_START_MINUTES) / DAY_RANGE) * 100}%` }}
                />
              ))}
              {dayBlocks.map((block) => (
                <button
                  key={block.id}
                  className={`week-block week-block--${block.state}`}
                  style={blockPosition(block)}
                  onClick={() =>
                    resolveAction(block, { role, blocks, selectedDraft, onSelectBlock, onSelectSession, horizonDays })
                  }
                  type="button"
                  disabled={!block.interactive}
                >
                  <span>{block.label ?? "Unavailable"}</span>
                  <small>
                    {formatTime(block.earliestStartAt ?? block.startsAt)}
                    {" - "}
                    {formatTime(block.endsAt)}
                  </small>
                </button>
              ))}

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
            </div>
          </section>
        );
      })}
    </div>
  );
}
