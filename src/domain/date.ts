const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function startOfToday(): number {
  return startOfDay(Date.now());
}

export function addDays(timestamp: number, count: number): number {
  return timestamp + count * DAY_MS;
}

export function toDayKey(timestamp: number): string {
  return new Date(startOfDay(timestamp)).toISOString().slice(0, 10);
}

export function formatDayLabel(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(timestamp);
}

export function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

export function timestampFromDayAndMinutes(dayStart: number, minutes: number): number {
  return dayStart + minutes * 60 * 1000;
}

export function minutesFromTimestamp(timestamp: number): number {
  const date = new Date(timestamp);
  return date.getHours() * 60 + date.getMinutes();
}

export function weekdayFromTimestamp(timestamp: number): number {
  const date = new Date(timestamp);
  return date.getDay();
}

export function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function formatDuration(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}
