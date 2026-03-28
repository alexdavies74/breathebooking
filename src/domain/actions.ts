import type { RowHandle } from "@vennbase/core";
import { db } from "../lib/db";
import type { Schema } from "../lib/schema";
import { formatDayLabel, formatTime, minutesFromTimestamp, weekdayFromTimestamp } from "./date";
import type { BookingDraft } from "./types";

type ProviderRow = RowHandle<Schema, "providers">;
type ClientRow = RowHandle<Schema, "clients">;
type SessionRow = RowHandle<Schema, "sessions">;
type BlockRow = RowHandle<Schema, "personalBlocks">;

export interface ClientConfigInput {
  fullName: string;
  email: string;
  phone?: string;
  address: string;
  minimumDurationMinutes: number;
  travelBeforeMin: number;
  travelBeforeMax: number;
  travelAfterMin: number;
  travelAfterMax: number;
  earlyStartEnabled: boolean;
  allowedWeekdays: number[];
  dayWindows: Record<number, { startMinutes: number; endMinutes: number; earliestStartMinutes?: number }>;
}

const DEFAULT_PROVIDER_WINDOWS = [
  { weekday: 1, startMinutes: 8 * 60, endMinutes: 13 * 60, sortKey: 1080 },
  { weekday: 1, startMinutes: 14 * 60, endMinutes: 19 * 60, sortKey: 1140 },
  { weekday: 2, startMinutes: 8 * 60, endMinutes: 13 * 60, sortKey: 2080 },
  { weekday: 2, startMinutes: 14 * 60, endMinutes: 19 * 60, sortKey: 2140 },
  { weekday: 3, startMinutes: 8 * 60, endMinutes: 13 * 60, sortKey: 3080 },
  { weekday: 3, startMinutes: 14 * 60, endMinutes: 19 * 60, sortKey: 3140 },
  { weekday: 4, startMinutes: 8 * 60, endMinutes: 13 * 60, sortKey: 4080 },
  { weekday: 4, startMinutes: 14 * 60, endMinutes: 19 * 60, sortKey: 4140 },
  { weekday: 5, startMinutes: 8 * 60, endMinutes: 13 * 60, sortKey: 5080 },
  { weekday: 5, startMinutes: 14 * 60, endMinutes: 19 * 60, sortKey: 5140 },
];

export async function createPractice(displayName: string, timezone: string) {
  console.info("[breathe debug] createPractice:start", {
    displayName,
    timezone,
  });

  const providerWrite = db.create("providers", {
    displayName,
    timezone,
    defaultWeekHorizon: 4,
  });
  console.info("[breathe debug] createPractice:optimistic-write", {
    status: providerWrite.status,
    optimisticProviderId: providerWrite.value.id,
  });

  try {
    const provider = await providerWrite.committed;
    console.info("[breathe debug] createPractice:provider-committed", {
      providerId: provider.id,
      owner: provider.owner,
    });

    await Promise.all(
      DEFAULT_PROVIDER_WINDOWS.map(async (window) => {
        console.info("[breathe debug] createPractice:availability-start", {
          providerId: provider.id,
          weekday: window.weekday,
          startMinutes: window.startMinutes,
          endMinutes: window.endMinutes,
        });
        const availabilityWrite = db.create("baseAvailabilityWindows", window, { in: provider });
        console.info("[breathe debug] createPractice:availability-optimistic-write", {
          providerId: provider.id,
          availabilityStatus: availabilityWrite.status,
          optimisticAvailabilityId: availabilityWrite.value.id,
          weekday: window.weekday,
        });
        const availabilityRow = await availabilityWrite.committed;
        console.info("[breathe debug] createPractice:availability-committed", {
          availabilityId: availabilityRow.id,
          weekday: window.weekday,
          startMinutes: window.startMinutes,
          endMinutes: window.endMinutes,
        });
      }),
    );

    console.info("[breathe debug] createPractice:complete", {
      providerId: provider.id,
      availabilityCount: DEFAULT_PROVIDER_WINDOWS.length,
    });

    return provider;
  } catch (error) {
    console.error("[breathe debug] createPractice:error", error);
    throw error;
  }
}

export async function createClientInvite(provider: ProviderRow, input: ClientConfigInput) {
  const clientWrite = db.create(
    "clients",
    {
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      address: input.address,
      status: "active",
      minimumDurationMinutes: input.minimumDurationMinutes,
      travelBeforeMin: input.travelBeforeMin,
      travelBeforeMax: input.travelBeforeMax,
      travelAfterMin: input.travelAfterMin,
      travelAfterMax: input.travelAfterMax,
      earlyStartEnabled: input.earlyStartEnabled,
    },
    { in: provider },
  );
  const client = await clientWrite.committed;

  await Promise.all(
    input.allowedWeekdays.map((weekday) => {
      const dayWindow = input.dayWindows[weekday];
      return db
        .create(
          "clientAllowedWindows",
          {
            weekday,
            startMinutes: dayWindow.startMinutes,
            endMinutes: dayWindow.endMinutes,
            earliestStartMinutes: dayWindow.earliestStartMinutes,
            sortKey: weekday * 1000 + dayWindow.startMinutes,
          },
          { in: client },
        )
        .committed;
    }),
  );

  const token = db.createInviteToken(provider).value;
  const url = new URL(db.createShareLink(provider, token.token));
  url.pathname = "/invite";
  url.searchParams.set("clientId", client.id);
  url.searchParams.set("clientName", client.fields.fullName);
  url.searchParams.set("providerName", provider.fields.displayName);

  return { client, inviteLink: url.toString() };
}

export async function createSessionBooking(args: {
  provider: ProviderRow;
  client: ClientRow;
  draft: BookingDraft;
  bookedByRole: "provider" | "client";
}) {
  const sessionLabel = `${formatDayLabel(args.draft.guaranteedStartAt)} · ${formatTime(
    args.draft.guaranteedStartAt,
  )}`;

  const sessionWrite = db.create(
    "sessions",
    {
      startsAt: args.draft.startsAt,
      guaranteedStartAt: args.draft.guaranteedStartAt,
      earliestStartAt: args.draft.earliestStartAt,
      durationMinutes: args.draft.durationMinutes,
      status: "confirmed",
      bookedByRole: args.bookedByRole,
      slotLabel: sessionLabel,
    },
    { in: args.client },
  );
  const session = await sessionWrite.committed;

  await db
    .create(
      "publicBusyWindows",
      {
        startsAt: args.draft.startsAt,
        endsAt: args.draft.guaranteedStartAt + args.draft.durationMinutes * 60 * 1000,
        kind: "session",
        originRef: session.id,
        label: sessionLabel,
      },
      { in: args.provider },
    )
    .committed;

  await db
    .create(
      "rebookingPresets",
      {
        weekday: weekdayFromTimestamp(args.draft.guaranteedStartAt),
        startMinutes: minutesFromTimestamp(args.draft.guaranteedStartAt),
        durationMinutes: args.draft.durationMinutes,
        earliestStartMinutes:
          args.draft.earliestStartAt === undefined
            ? undefined
            : minutesFromTimestamp(args.draft.earliestStartAt),
        label: sessionLabel,
        lastUsedAt: Date.now(),
      },
      { in: args.client },
    )
    .committed;

  return session;
}

export async function cancelSession(provider: ProviderRow, session: SessionRow) {
  await db.update("sessions", session, { status: "canceled" }).committed;
  const busyRows = await db.query("publicBusyWindows", { in: provider, index: "byStart", order: "asc" });
  const busyRow = busyRows.find((row) => row.fields.originRef === session.id && row.fields.kind === "session");
  if (busyRow) {
    await db.update("publicBusyWindows", busyRow, { kind: "inactive" }).committed;
  }
}

export async function createPersonalBlock(args: {
  provider: ProviderRow;
  startsAt: number;
  endsAt: number;
  label: string;
}) {
  const blockWrite = db.create(
    "personalBlocks",
    {
      startsAt: args.startsAt,
      endsAt: args.endsAt,
      source: "manual",
      label: args.label,
    },
    { in: args.provider },
  );
  const block = await blockWrite.committed;

  await db
    .create(
      "publicBusyWindows",
      {
        startsAt: args.startsAt,
        endsAt: args.endsAt,
        kind: "block",
        originRef: block.id,
        label: args.label,
      },
      { in: args.provider },
    )
    .committed;

  return block;
}

export async function deactivatePersonalBlock(provider: ProviderRow, block: BlockRow) {
  await db.update("personalBlocks", block, { source: "inactive" }).committed;
  const busyRows = await db.query("publicBusyWindows", { in: provider, index: "byStart", order: "asc" });
  const busyRow = busyRows.find((row) => row.fields.originRef === block.id && row.fields.kind === "block");
  if (busyRow) {
    await db.update("publicBusyWindows", busyRow, { kind: "inactive" }).committed;
  }
}
