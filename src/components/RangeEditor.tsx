import { clamp, formatDuration } from "../domain/date";

interface RangeEditorProps {
  minMinutes: number;
  maxMinutes: number;
  step: number;
  minDurationMinutes: number;
  startMinutes: number;
  endMinutes: number;
  earliestStartMinutes?: number;
  allowEarlyStart?: boolean;
  onChange(next: { startMinutes: number; endMinutes: number; earliestStartMinutes?: number }): void;
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const suffix = hours >= 12 ? "PM" : "AM";
  const normalizedHours = hours % 12 || 12;
  return `${normalizedHours}:${String(mins).padStart(2, "0")} ${suffix}`;
}

export function RangeEditor(props: RangeEditorProps) {
  const startValue = props.startMinutes;
  const endValue = props.endMinutes;
  const earliestValue = props.earliestStartMinutes ?? startValue;

  return (
    <div className="range-editor">
      <div className="range-editor__summary">
        <div>
          <span className="eyebrow">Guaranteed start</span>
          <strong>{formatMinutes(startValue)}</strong>
        </div>
        <div>
          <span className="eyebrow">Duration</span>
          <strong>{formatDuration(endValue - startValue)}</strong>
        </div>
        <div>
          <span className="eyebrow">Arrival</span>
          <strong>
            {props.allowEarlyStart && props.earliestStartMinutes !== undefined
              ? `${formatMinutes(earliestValue)} to ${formatMinutes(startValue)}`
              : formatMinutes(startValue)}
          </strong>
        </div>
      </div>

      <label className="field">
        <span>Start</span>
        <input
          aria-label="Start"
          type="range"
          min={props.minMinutes}
          max={endValue - props.minDurationMinutes}
          step={props.step}
          value={startValue}
          onChange={(event) => {
            const nextStart = Number(event.target.value);
            const nextEarliest =
              props.allowEarlyStart && props.earliestStartMinutes !== undefined
                ? clamp(props.earliestStartMinutes, props.minMinutes, nextStart)
                : undefined;
            props.onChange({
              startMinutes: nextStart,
              endMinutes: Math.max(endValue, nextStart + props.minDurationMinutes),
              earliestStartMinutes: nextEarliest,
            });
          }}
        />
      </label>

      <label className="field">
        <span>End</span>
        <input
          aria-label="End"
          type="range"
          min={startValue + props.minDurationMinutes}
          max={props.maxMinutes}
          step={props.step}
          value={endValue}
          onChange={(event) => {
            props.onChange({
              startMinutes: startValue,
              endMinutes: Number(event.target.value),
              earliestStartMinutes: props.earliestStartMinutes,
            });
          }}
        />
      </label>

      {props.allowEarlyStart && props.earliestStartMinutes !== undefined ? (
        <label className="field">
          <span>Possible early arrival</span>
          <input
            aria-label="Possible early arrival"
            type="range"
            min={props.minMinutes}
            max={startValue}
            step={props.step}
            value={earliestValue}
            onChange={(event) => {
              props.onChange({
                startMinutes: startValue,
                endMinutes: endValue,
                earliestStartMinutes: Number(event.target.value),
              });
            }}
          />
        </label>
      ) : null}
    </div>
  );
}
