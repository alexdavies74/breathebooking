import type { RowHandle } from "@vennbase/core";
import { describe, expect, it, vi } from "vitest";
import { buildClientWeekBlocks, createBookingDraftFromBlock, findNextMatchingSlot } from "./availability";
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
      sessions: [],
      publicBusyWindows: [],
      client: row("clients", "client-1", {
        fullName: "A",
        status: "active",
        minimumDurationMinutes: 180,
        travelTimeMinutes: 30,
      }),
      horizonDays: 1,
    });

    expect(blocks.map((block) => block.state)).toEqual(["available"]);
  });

  it("buffers busy windows by client travel time before subtracting availability", () => {
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
      sessions: [],
      publicBusyWindows: [
        row("publicBusyWindows", "busy-1", {
          startsAt: today.getTime() + 10 * 60 * 60 * 1000,
          endsAt: today.getTime() + 12 * 60 * 60 * 1000,
          kind: "session",
          originRef: "other-session",
          label: "Unavailable",
        }),
      ],
      client: row("clients", "client-1", {
        fullName: "A",
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
        sessions: [],
        publicBusyWindows: [
          row("publicBusyWindows", "busy-1", {
            startsAt: new Date("2026-03-30T09:30:00").getTime(),
            endsAt: new Date("2026-03-30T13:30:00").getTime(),
            kind: "personal",
            originRef: "personal-1",
            label: "Personal errand",
          }),
        ],
        client: row("clients", "client-1", {
          fullName: "A",
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
