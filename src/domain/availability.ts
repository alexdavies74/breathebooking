import type { DbQueryProjectedRow, RowHandle } from "@vennbase/core";
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
type BookingRow = RowHandle<Schema, "bookings">;
type BookingKeyRow = DbQueryProjectedRow<Schema, "bookings">;
type BookingBlockKeyRow = DbQueryProjectedRow<Schema, "bookingBlocks">;
type PersonalBlockRow = RowHandle<Schema, "personalBlocks">;
type PresetRow = RowHandle<Schema, "rebookingPresets">;
type ClientRow = RowHandle<Schema, "clients">;
type SavedBookingRow = RowHandle<Schema, "savedBookings">;

interface BusyRange {
  id: string;
  startsAt: number;
  endsAt: number;
  kind: "booking" | "block";
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

function activeBookings(rows: BookingRow[]): BookingRow[] {
  return rows.filter((row) => row.fields.status !== "canceled");
}

function activeSavedBookings(rows: SavedBookingRow[]): SavedBookingRow[] {
  return rows.filter((row) => row.fields.status !== "canceled");
}

function toBookedOwnBlock(savedBooking: SavedBookingRow): WeekBlock {
  const startsAt = savedBooking.fields.earliestStartAt ?? savedBooking.fields.guaranteedStartAt;

  return {
    id: savedBooking.fields.bookingRef.id,
    dayKey: toDayKey(startsAt),
    startsAt,
    endsAt: savedBooking.fields.endsAt,
    state: "booked-own",
    interactive: true,
    label: savedBooking.fields.slotLabel,
    guaranteedStartAt: savedBooking.fields.guaranteedStartAt,
    earliestStartAt: savedBooking.fields.earliestStartAt,
    bookingRef: savedBooking.fields.bookingRef,
    sourceKind: "booking",
    sourceId: savedBooking.fields.bookingRef.id,
    weekday: weekdayFromTimestamp(startsAt),
  };
}

function toBookedProviderBlock(booking: BookingRow): WeekBlock {
  const startsAt = booking.fields.earliestStartAt ?? booking.fields.guaranteedStartAt;

  return {
    id: booking.id,
    dayKey: toDayKey(startsAt),
    startsAt,
    endsAt: booking.fields.endsAt,
    state: "booked-own",
    interactive: true,
    label: booking.fields.slotLabel,
    guaranteedStartAt: booking.fields.guaranteedStartAt,
    earliestStartAt: booking.fields.earliestStartAt,
    bookingRef: booking.ref,
    sourceKind: "booking",
    sourceId: booking.id,
    weekday: weekdayFromTimestamp(startsAt),
  };
}

function toBufferedBookingRange(row: BookingKeyRow, travelTimeMinutes: number): BusyRange {
  const travelMs = travelTimeMinutes * 60 * 1000;
  return {
    id: row.id,
    startsAt: row.fields.startsAt - travelMs,
    endsAt: row.fields.endsAt + travelMs,
    kind: "booking",
  };
}

function toBufferedBlockRange(row: BookingBlockKeyRow, travelTimeMinutes: number): BusyRange {
  const travelMs = travelTimeMinutes * 60 * 1000;
  return {
    id: row.id,
    startsAt: row.fields.startsAt - travelMs,
    endsAt: row.fields.endsAt + travelMs,
    kind: "block",
  };
}

function toBlockedBlock(row: BusyRange): WeekBlock {
  return {
    id: row.id,
    dayKey: toDayKey(row.startsAt),
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    state: row.kind === "block" ? "blocked" : "booked-other",
    interactive: false,
    label: "Unavailable",
    sourceKind: "busy",
    sourceId: row.id,
    weekday: weekdayFromTimestamp(row.startsAt),
  };
}

export function buildProviderWeekBlocks(args: {
  baseAvailability: AvailabilityRow[];
  personalBlocks: PersonalBlockRow[];
  bookings: BookingRow[];
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

  const bookingBlocks = activeBookings(args.bookings).map((booking) => toBookedProviderBlock(booking));

  return [...windows.flatMap(createAvailableBlock), ...providerBlocks, ...bookingBlocks].sort(
    (left, right) => left.startsAt - right.startsAt,
  );
}

export function buildClientWeekBlocks(args: {
  baseAvailability: AvailabilityRow[];
  bookings: BookingKeyRow[];
  bookingBlocks: BookingBlockKeyRow[];
  savedBookings: SavedBookingRow[];
  client: ClientRow;
  horizonDays: number;
  excludeBookingId?: string;
}): WeekBlock[] {
  let windows = toDayWindowsFromBase(
    args.baseAvailability.filter((row) => row.fields.status !== "inactive"),
    args.horizonDays,
  );
  const ownBookings = activeSavedBookings(args.savedBookings).filter(
    (row) => row.fields.bookingRef.id !== args.excludeBookingId,
  );
  const ownBookingIds = new Set(ownBookings.map((row) => row.fields.bookingRef.id));
  const sharedBookingRanges = args.bookings
    .filter((row) => row.id !== args.excludeBookingId)
    .map((row) => toBufferedBookingRange(row, args.client.fields.travelTimeMinutes));
  const sharedBlockRanges = args.bookingBlocks.map((row) =>
    toBufferedBlockRange(row, args.client.fields.travelTimeMinutes),
  );
  const busyRanges = [...sharedBookingRanges, ...sharedBlockRanges];

  busyRanges.forEach((row) => {
    windows = subtractRange(windows, row.startsAt, row.endsAt);
  });

  windows = windows.filter((window) => canFitDuration(window, args.client.fields.minimumDurationMinutes));

  const ownBookingBlocks = ownBookings.map((booking) => toBookedOwnBlock(booking));
  const blockedBlocks = busyRanges
    .filter((row) => row.kind === "block" || !ownBookingIds.has(row.id))
    .map((row) => toBlockedBlock(row));

  return [...windows.flatMap(createAvailableBlock), ...ownBookingBlocks, ...blockedBlocks].sort(
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

export function toSlotShapeFromSavedBooking(
  savedBooking: Pick<SavedBookingRow, "fields">,
): SlotShape {
  return {
    weekday: weekdayFromTimestamp(savedBooking.fields.guaranteedStartAt),
    startMinutes: minutesFromTimestamp(savedBooking.fields.guaranteedStartAt),
    durationMinutes: savedBooking.fields.durationMinutes,
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
