import type { DbIndexKeyProjection, RowHandle } from "@vennbase/core";
import { describe, expect, it, vi } from "vitest";
import {
  buildClientWeekBlocks,
  createBookingDraftFromBlock,
  findMatchingSlotAtTime,
  findNextMatchingSlot,
  findSlotContainingTime,
} from "./availability";
import type { Schema } from "../lib/schema";
import { minutesFromTimestamp, toDayKey } from "./date";

function row<TCollection extends keyof Schema & string>(
  collection: TCollection,
  id: string,
  fields: Record<string, unknown>,
): RowHandle<Schema, TCollection> {
  return {
    id,
    collection,
    fields,
    ref: { id, collection, baseUrl: "http://localhost:5173" },
  } as unknown as RowHandle<Schema, TCollection>;
}

function keyRow<TCollection extends "bookings" | "bookingBlocks">(
  collection: TCollection,
  id: string,
  fields: Record<string, unknown>,
): DbIndexKeyProjection<Schema, TCollection> {
  return {
    id,
    collection,
    fields,
  } as unknown as DbIndexKeyProjection<Schema, TCollection>;
}

describe("availability engine", () => {
  it("builds client availability from provider base windows", () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekday = today.getDay();

    const blocks = buildClientWeekBlocks({
      baseAvailability: [
        row("baseAvailabilityWindows", "window-1", {
          weekday,
          startMinutes: 9 * 60,
          endMinutes: 13 * 60,
          status: "active",
          sortKey: 1,
        }),
      ],
      bookings: [],
      bookingBlocks: [],
      savedBookings: [],
      client: row("clients", "client-1", {
        fullName: "A",
        providerViewerLink: "http://localhost/invite",
        status: "active",
        minimumDurationMinutes: 180,
        travelTimeMinutes: 30,
      }),
      horizonDays: 1,
    });

    expect(blocks.map((block) => block.state)).toEqual(["available"]);
  });

  it("buffers other bookings by client travel time before subtracting availability", () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekday = today.getDay();

    const blocks = buildClientWeekBlocks({
      baseAvailability: [
        row("baseAvailabilityWindows", "window-1", {
          weekday,
          startMinutes: 9 * 60,
          endMinutes: 14 * 60,
          status: "active",
          sortKey: 1,
        }),
      ],
      bookings: [
        keyRow("bookings", "booking-2", {
          startsAt: today.getTime() + 10 * 60 * 60 * 1000,
          endsAt: today.getTime() + 12 * 60 * 60 * 1000,
        }),
      ],
      bookingBlocks: [],
      savedBookings: [],
      client: row("clients", "client-1", {
        fullName: "A",
        providerViewerLink: "http://localhost/invite",
        status: "active",
        minimumDurationMinutes: 30,
        travelTimeMinutes: 30,
      }),
      horizonDays: 1,
    });

    expect(blocks.some((block) => block.state === "booked-other")).toBe(true);
    expect(blocks.filter((block) => block.state === "available")).toHaveLength(2);
    expect(minutesFromTimestamp(blocks.find((block) => block.state === "available")?.endsAt ?? 0)).toBe(9 * 60 + 30);
  });

  it("drops leftover availability that cannot fit the client's minimum duration after travel buffering", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T12:00:00"));
    try {
      const blocks = buildClientWeekBlocks({
        baseAvailability: [
          row("baseAvailabilityWindows", "window-1", {
            weekday: 1,
            startMinutes: 7 * 60 + 30,
            endMinutes: 11 * 60 + 30,
            status: "active",
            sortKey: 1,
          }),
        ],
        bookings: [],
        bookingBlocks: [
          keyRow("bookingBlocks", "block-1", {
            startsAt: new Date("2026-03-30T09:30:00").getTime(),
            endsAt: new Date("2026-03-30T13:30:00").getTime(),
          }),
        ],
        savedBookings: [],
        client: row("clients", "client-1", {
          fullName: "A",
          providerViewerLink: "http://localhost/invite",
          status: "active",
          minimumDurationMinutes: 180,
          travelTimeMinutes: 30,
        }),
        horizonDays: 2,
      });

      expect(
        blocks.some(
          (block) =>
            block.dayKey === "2026-03-30" &&
            block.state === "available" &&
            minutesFromTimestamp(block.startsAt) === 7 * 60 + 30,
        ),
      ).toBe(false);
      expect(blocks.filter((block) => block.dayKey === "2026-03-30" && block.state === "available")).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reopens the slot for the booking being edited", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T12:00:00"));
    try {
      const bookingStart = new Date("2026-03-30T10:00:00").getTime();
      const bookingEnd = new Date("2026-03-30T13:00:00").getTime();

      const blocks = buildClientWeekBlocks({
        baseAvailability: [
          row("baseAvailabilityWindows", "window-1", {
            weekday: 1,
            startMinutes: 9 * 60,
            endMinutes: 14 * 60,
            status: "active",
            sortKey: 1,
          }),
        ],
        bookings: [
          keyRow("bookings", "booking-1", {
            startsAt: bookingStart,
            endsAt: bookingEnd,
          }),
        ],
        bookingBlocks: [],
        savedBookings: [
          row("savedBookings", "saved-booking-1", {
            clientRef: { id: "client-1", collection: "clients", baseUrl: "http://localhost:5173" },
            bookingRef: { id: "booking-1", collection: "bookings", baseUrl: "http://localhost:5173" },
            status: "active",
            startsAt: bookingStart,
            endsAt: bookingEnd,
            guaranteedStartAt: bookingStart,
            earliestStartAt: undefined,
            durationMinutes: 180,
            bookedByRole: "client",
            slotLabel: "Mon, Mar 30 · 10:00 AM",
          }),
        ],
        client: row("clients", "client-1", {
          fullName: "A",
          providerViewerLink: "http://localhost/invite",
          status: "active",
          minimumDurationMinutes: 180,
          travelTimeMinutes: 0,
        }),
        horizonDays: 2,
        excludeBookingId: "booking-1",
      });

      const editableSlot = findSlotContainingTime(blocks, bookingStart, 180);

      expect(editableSlot?.state).toBe("available");
      expect(editableSlot?.dayKey).toBe("2026-03-30");
    } finally {
      vi.useRealTimers();
    }
  });

  it("matches the next slot by weekday and duration", () => {
    const block = {
      id: "block-1",
      dayKey: "2026-03-30",
      startsAt: new Date("2026-03-30T09:00:00").getTime(),
      endsAt: new Date("2026-03-30T13:00:00").getTime(),
      state: "available" as const,
      interactive: true,
      guaranteedStartAt: new Date("2026-03-30T09:00:00").getTime(),
    };

    const found = findNextMatchingSlot([block], {
      weekday: 1,
      startMinutes: 9 * 60,
      durationMinutes: 180,
    });

    expect(found?.id).toBe("block-1");
  });

  it("matches an exact slot one week later by timestamp and duration", () => {
    const startAt = new Date("2026-04-06T14:00:00").getTime();
    const block = {
      id: "block-1",
      dayKey: "2026-04-06",
      startsAt: new Date("2026-04-06T13:30:00").getTime(),
      endsAt: new Date("2026-04-06T18:00:00").getTime(),
      state: "maybe" as const,
      interactive: true,
      guaranteedStartAt: startAt,
      earliestStartAt: new Date("2026-04-06T13:30:00").getTime(),
    };

    const found = findMatchingSlotAtTime([block], startAt, 180);

    expect(found?.id).toBe("block-1");
  });

  it("finds the bookable slot containing an existing booking time", () => {
    const startAt = new Date("2026-04-06T10:00:00").getTime();
    const block = {
      id: "block-1",
      dayKey: "2026-04-06",
      startsAt: new Date("2026-04-06T09:00:00").getTime(),
      endsAt: new Date("2026-04-06T14:00:00").getTime(),
      state: "available" as const,
      interactive: true,
      guaranteedStartAt: new Date("2026-04-06T09:00:00").getTime(),
    };

    const found = findSlotContainingTime([block], startAt, 180);

    expect(found?.id).toBe("block-1");
  });

  it("anchors booking drafts to the selected block day", () => {
    const draft = createBookingDraftFromBlock(
      {
        id: "block-1",
        dayKey: "2026-03-30",
        startsAt: new Date("2026-03-30T08:30:00").getTime(),
        endsAt: new Date("2026-03-30T13:00:00").getTime(),
        state: "maybe",
        interactive: true,
        guaranteedStartAt: new Date("2026-03-30T09:00:00").getTime(),
        earliestStartAt: new Date("2026-03-30T08:30:00").getTime(),
      },
      180,
      { weekday: 1, startMinutes: 9 * 60, durationMinutes: 180, earliestStartMinutes: 8 * 60 + 30 },
    );

    expect(toDayKey(draft.guaranteedStartAt)).toBe("2026-03-30");
    expect(minutesFromTimestamp(draft.guaranteedStartAt)).toBe(9 * 60);
    expect(draft.startsAt).toBe(draft.guaranteedStartAt);
  });
});
