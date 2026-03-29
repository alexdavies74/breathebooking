import type { RowHandle } from "@vennbase/core";
import type { Schema } from "../lib/schema";
import {
  addDays,
  clamp,
  formatDayLabel,
  formatTime,
  minutesFromTimestamp,
  overlaps,
  startOfToday,
  timestampFromDayAndMinutes,
  toDayKey,
  weekdayFromTimestamp,
} from "./date";
import type { BookingDraft, SlotShape, WeekBlock } from "./types";

type AvailabilityRow = RowHandle<Schema, "baseAvailabilityWindows">;
type SessionRow = RowHandle<Schema, "sessions">;
type PersonalBlockRow = RowHandle<Schema, "personalBlocks">;
type BusyWindowRow = RowHandle<Schema, "publicBusyWindows">;
type PresetRow = RowHandle<Schema, "rebookingPresets">;
type ClientRow = RowHandle<Schema, "clients">;

interface BusyWindowShape {
  id: string;
  fields: {
    startsAt: number;
    endsAt: number;
    kind: string;
    originRef: string;
    label?: string;
  };
}

interface DayWindow {
  id: string;
  sourceId: string;
  weekday: number;
  dayStart: number;
  start: number;
  end: number;
  earliestStart?: number;
}

function canFitDuration(window: DayWindow, durationMinutes: number): boolean {
  return window.end - window.start >= durationMinutes * 60 * 1000;
}

function toDayWindowsFromBase(rows: AvailabilityRow[], horizonDays: number): DayWindow[] {
  const today = startOfToday();
  const windows: DayWindow[] = [];

  for (let offset = 0; offset < horizonDays; offset += 1) {
    const dayStart = addDays(today, offset);
    const weekday = weekdayFromTimestamp(dayStart);

    rows
      .filter((row) => row.fields.weekday === weekday)
      .forEach((row) => {
        windows.push({
          id: `${row.id}-${offset}`,
          sourceId: row.id,
          weekday,
          dayStart,
          start: timestampFromDayAndMinutes(dayStart, row.fields.startMinutes),
          end: timestampFromDayAndMinutes(dayStart, row.fields.endMinutes),
        });
      });
  }

  return windows;
}

function subtractRange(windows: DayWindow[], start: number, end: number): DayWindow[] {
  const next: DayWindow[] = [];

  windows.forEach((window) => {
    if (!overlaps(window.start, window.end, start, end)) {
      next.push(window);
      return;
    }

    if (start > window.start) {
      next.push({
        ...window,
        id: `${window.id}-left-${start}`,
        end: start,
      });
    }

    if (end < window.end) {
      next.push({
        ...window,
        id: `${window.id}-right-${end}`,
        start: end,
        earliestStart:
          window.earliestStart !== undefined && window.earliestStart < end
            ? undefined
            : window.earliestStart,
      });
    }
  });

  return next;
}

function toBookedOwnBlock(session: SessionRow): WeekBlock {
  const startsAt = session.fields.earliestStartAt ?? session.fields.guaranteedStartAt;
  const endsAt = session.fields.guaranteedStartAt + session.fields.durationMinutes * 60 * 1000;

  return {
    id: session.id,
    dayKey: toDayKey(startsAt),
    startsAt,
    endsAt,
    state: "booked-own",
    interactive: true,
    label: session.fields.slotLabel,
    guaranteedStartAt: session.fields.guaranteedStartAt,
    earliestStartAt: session.fields.earliestStartAt,
    sessionRef: session.ref,
    sourceKind: "session",
    sourceId: session.id,
    weekday: weekdayFromTimestamp(startsAt),
  };
}

function createAvailableBlock(window: DayWindow): WeekBlock[] {
  if (window.earliestStart !== undefined && window.earliestStart < window.start) {
    return [
      {
        id: `${window.id}-maybe`,
        dayKey: toDayKey(window.dayStart),
        startsAt: window.earliestStart,
        endsAt: window.start,
        state: "maybe",
        interactive: true,
        label: `From ${formatTime(window.earliestStart)} if traffic is light`,
        guaranteedStartAt: window.start,
        earliestStartAt: window.earliestStart,
        sourceKind: "availability",
        sourceId: window.sourceId,
        weekday: window.weekday,
      },
      {
        id: `${window.id}-available`,
        dayKey: toDayKey(window.dayStart),
        startsAt: window.start,
        endsAt: window.end,
        state: "available",
        interactive: true,
        label: `${formatDayLabel(window.dayStart)} open`,
        guaranteedStartAt: window.start,
        sourceKind: "availability",
        sourceId: window.sourceId,
        weekday: window.weekday,
      },
    ];
  }

  return [
    {
      id: `${window.id}-available`,
      dayKey: toDayKey(window.dayStart),
      startsAt: window.start,
      endsAt: window.end,
      state: "available",
      interactive: true,
      label: `${formatDayLabel(window.dayStart)} open`,
      guaranteedStartAt: window.start,
      sourceKind: "availability",
      sourceId: window.sourceId,
      weekday: window.weekday,
    },
  ];
}

function activeSessions(rows: SessionRow[]): SessionRow[] {
  return rows.filter((row) => row.fields.status !== "canceled");
}

function activeBusyWindows(rows: BusyWindowRow[]): BusyWindowShape[] {
  return rows.filter((row) => row.fields.kind !== "inactive");
}

function toBlockedBlock(row: BusyWindowShape, ownSessionIds: Set<string>): WeekBlock {
  return {
    id: row.id,
    dayKey: toDayKey(row.fields.startsAt),
    startsAt: row.fields.startsAt,
    endsAt: row.fields.endsAt,
    state: ownSessionIds.has(row.fields.originRef) ? "booked-own" : "booked-other",
    interactive: ownSessionIds.has(row.fields.originRef),
    label: ownSessionIds.has(row.fields.originRef) ? row.fields.label : "Unavailable",
    sourceKind: ownSessionIds.has(row.fields.originRef) ? "session" : "busy",
    sourceId: row.fields.originRef,
    weekday: weekdayFromTimestamp(row.fields.startsAt),
  };
}

export function buildProviderWeekBlocks(args: {
  baseAvailability: AvailabilityRow[];
  personalBlocks: PersonalBlockRow[];
  sessions: SessionRow[];
  horizonDays: number;
}): WeekBlock[] {
  const windows = toDayWindowsFromBase(
    args.baseAvailability.filter((row) => row.fields.status !== "inactive"),
    args.horizonDays,
  );
  const providerBlocks = args.personalBlocks
    .filter((row) => row.fields.source !== "inactive")
    .map<WeekBlock>((row) => ({
      id: row.id,
      dayKey: toDayKey(row.fields.startsAt),
      startsAt: row.fields.startsAt,
      endsAt: row.fields.endsAt,
      state: "blocked",
      interactive: true,
      label: row.fields.label ?? "Personal block",
      sourceKind: "personal-block",
      sourceId: row.id,
      weekday: weekdayFromTimestamp(row.fields.startsAt),
    }));

  const sessionBlocks = activeSessions(args.sessions).map((session) => toBookedOwnBlock(session));

  return [...windows.flatMap(createAvailableBlock), ...providerBlocks, ...sessionBlocks].sort(
    (left, right) => left.startsAt - right.startsAt,
  );
}

export function buildClientWeekBlocks(args: {
  baseAvailability: AvailabilityRow[];
  sessions: SessionRow[];
  publicBusyWindows: BusyWindowRow[];
  client: ClientRow;
  horizonDays: number;
  excludeSessionId?: string;
}): WeekBlock[] {
  let windows = toDayWindowsFromBase(
    args.baseAvailability.filter((row) => row.fields.status !== "inactive"),
    args.horizonDays,
  );
  const sessions = activeSessions(args.sessions).filter((row) => row.id !== args.excludeSessionId);
  const busyWindows = activeBusyWindows(args.publicBusyWindows)
    .filter((row) => row.fields.originRef !== args.excludeSessionId)
    .map((row) => ({
      ...row,
      fields: {
        ...row.fields,
        startsAt: row.fields.startsAt - args.client.fields.travelTimeMinutes * 60 * 1000,
        endsAt: row.fields.endsAt + args.client.fields.travelTimeMinutes * 60 * 1000,
      },
    }));

  busyWindows.forEach((row) => {
    windows = subtractRange(windows, row.fields.startsAt, row.fields.endsAt);
  });

  windows = windows.filter((window) => canFitDuration(window, args.client.fields.minimumDurationMinutes));

  const ownSessionIds = new Set(sessions.map((session) => session.id));
  const sessionBlocks = sessions.map((session) => toBookedOwnBlock(session));
  const blockedBlocks = busyWindows
    .filter((row) => !ownSessionIds.has(row.fields.originRef))
    .map((row) => toBlockedBlock(row, ownSessionIds));

  return [...windows.flatMap(createAvailableBlock), ...sessionBlocks, ...blockedBlocks].sort(
    (left, right) => left.startsAt - right.startsAt,
  );
}

export function createBookingDraftFromBlock(
  block: WeekBlock,
  minimumDurationMinutes: number,
  previousShape?: SlotShape,
): BookingDraft {
  const dayStart = new Date(`${block.dayKey}T00:00:00`).getTime();
  const minStartAt = block.guaranteedStartAt ?? block.startsAt;
  const maxDurationMinutes = Math.round((block.endsAt - minStartAt) / (60 * 1000));
  const preferredStart = previousShape
    ? timestampFromDayAndMinutes(dayStart, previousShape.startMinutes)
    : undefined;
  const baseStart = previousShape
    ? Math.max(minStartAt, preferredStart ?? block.startsAt)
    : minStartAt;
  const durationMinutes = Math.max(
    minimumDurationMinutes,
    Math.min(previousShape?.durationMinutes ?? minimumDurationMinutes, maxDurationMinutes),
  );
  const guaranteedStartAt = clamp(baseStart, minStartAt, block.endsAt - durationMinutes * 60 * 1000);

  return {
    startsAt: guaranteedStartAt,
    guaranteedStartAt,
    earliestStartAt: undefined,
    endsAt: guaranteedStartAt + durationMinutes * 60 * 1000,
    durationMinutes,
    dayKey: block.dayKey,
    sourceBlockId: block.id,
  };
}

export function createBookingDraftFromPreviousSession(session: SessionRow): BookingDraft {
  const startsAt = session.fields.guaranteedStartAt;
  return {
    startsAt,
    guaranteedStartAt: session.fields.guaranteedStartAt,
    earliestStartAt: undefined,
    endsAt: session.fields.guaranteedStartAt + session.fields.durationMinutes * 60 * 1000,
    durationMinutes: session.fields.durationMinutes,
    dayKey: toDayKey(startsAt),
    sourceBlockId: session.id,
  };
}

export function toSlotShapeFromSession(session: SessionRow): SlotShape {
  return {
    weekday: weekdayFromTimestamp(session.fields.guaranteedStartAt),
    startMinutes: minutesFromTimestamp(session.fields.guaranteedStartAt),
    durationMinutes: session.fields.durationMinutes,
  };
}

function isBookableSlot(block: WeekBlock): boolean {
  return block.state === "available" || block.state === "maybe";
}

export function findSlotContainingTime(blocks: WeekBlock[], startsAt: number, durationMinutes: number): WeekBlock | null {
  const endsAt = startsAt + durationMinutes * 60 * 1000;
  return (
    blocks.find((block) => {
      if (!isBookableSlot(block)) {
        return false;
      }

      const blockStart = block.guaranteedStartAt ?? block.startsAt;
      return startsAt >= blockStart && endsAt <= block.endsAt;
    }) ?? null
  );
}

export function findMatchingSlotAtTime(blocks: WeekBlock[], startsAt: number, durationMinutes: number): WeekBlock | null {
  return (
    blocks.find((block) => {
      if (!isBookableSlot(block)) {
        return false;
      }

      const blockStart = block.guaranteedStartAt ?? block.startsAt;
      return blockStart === startsAt && Math.round((block.endsAt - blockStart) / (60 * 1000)) >= durationMinutes;
    }) ?? null
  );
}

export function findNextMatchingSlot(blocks: WeekBlock[], shape: SlotShape): WeekBlock | null {
  return (
    blocks.find((block) => {
      if (!isBookableSlot(block)) {
        return false;
      }

      const blockStart = block.guaranteedStartAt ?? block.startsAt;
      return (
        weekdayFromTimestamp(blockStart) === shape.weekday &&
        minutesFromTimestamp(blockStart) === shape.startMinutes &&
        Math.round((block.endsAt - blockStart) / (60 * 1000)) >= shape.durationMinutes
      );
    }) ?? null
  );
}

export function dedupePresetShapes(rows: PresetRow[]): SlotShape[] {
  const seen = new Set<string>();
  const shapes: SlotShape[] = [];

  rows
    .sort((left, right) => right.fields.lastUsedAt - left.fields.lastUsedAt)
    .forEach((row) => {
      const key = `${row.fields.weekday}:${row.fields.startMinutes}:${row.fields.durationMinutes}`;
      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      shapes.push({
        weekday: row.fields.weekday,
        startMinutes: row.fields.startMinutes,
        durationMinutes: row.fields.durationMinutes,
      });
    });

  return shapes;
}
