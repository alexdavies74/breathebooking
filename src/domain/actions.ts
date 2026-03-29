import type { RowHandle } from "@vennbase/core";
import { db } from "../lib/db";
import type { Schema } from "../lib/schema";
import { formatDayLabel, formatTime, minutesFromTimestamp, weekdayFromTimestamp } from "./date";
import type { BookingDraft } from "./types";

type ProviderRow = RowHandle<Schema, "providers">;
type ClientRow = RowHandle<Schema, "clients">;
type SessionRow = RowHandle<Schema, "sessions">;
type BlockRow = RowHandle<Schema, "personalBlocks">;
type BaseAvailabilityRow = RowHandle<Schema, "baseAvailabilityWindows">;

export interface CreateClientInput {
  fullName: string;
}

export interface ClientSettingsInput {
  minimumDurationMinutes: number;
  travelTimeMinutes: number;
}

const DEFAULT_PROVIDER_WINDOWS = [
  { weekday: 1, startMinutes: 8 * 60, endMinutes: 13 * 60, status: "active", sortKey: 1080 },
  { weekday: 1, startMinutes: 14 * 60, endMinutes: 19 * 60, status: "active", sortKey: 1140 },
  { weekday: 2, startMinutes: 8 * 60, endMinutes: 13 * 60, status: "active", sortKey: 2080 },
  { weekday: 2, startMinutes: 14 * 60, endMinutes: 19 * 60, status: "active", sortKey: 2140 },
  { weekday: 3, startMinutes: 8 * 60, endMinutes: 13 * 60, status: "active", sortKey: 3080 },
  { weekday: 3, startMinutes: 14 * 60, endMinutes: 19 * 60, status: "active", sortKey: 3140 },
  { weekday: 4, startMinutes: 8 * 60, endMinutes: 13 * 60, status: "active", sortKey: 4080 },
  { weekday: 4, startMinutes: 14 * 60, endMinutes: 19 * 60, status: "active", sortKey: 4140 },
  { weekday: 5, startMinutes: 8 * 60, endMinutes: 13 * 60, status: "active", sortKey: 5080 },
  { weekday: 5, startMinutes: 14 * 60, endMinutes: 19 * 60, status: "active", sortKey: 5140 },
];

export async function createPractice(displayName: string, timezone: string, ownerUsername: string) {
  const providerWrite = db.create("providers", {
    displayName,
    timezone,
    ownerUsername,
    defaultWeekHorizon: 4,
  });

  const provider = await providerWrite.committed;

  await Promise.all(
    DEFAULT_PROVIDER_WINDOWS.map(async (window) => {
      const availabilityWrite = db.create("baseAvailabilityWindows", window, { in: provider });
      await availabilityWrite.committed;
    }),
  );

  return provider;
}

export async function createClient(provider: ProviderRow, input: CreateClientInput) {
  const clientWrite = db.create(
    "clients",
    {
      fullName: input.fullName,
      status: "active",
      minimumDurationMinutes: 180,
      travelTimeMinutes: 30,
    },
    { in: provider },
  );
  const client = await clientWrite.committed;

  const token = db.createInviteToken(provider).value;
  const url = new URL(db.createShareLink(provider, token.token));
  url.pathname = "/invite";
  url.searchParams.set("clientId", client.id);
  url.searchParams.set("clientName", client.fields.fullName);
  url.searchParams.set("providerName", provider.fields.displayName);

  return { client, inviteLink: url.toString() };
}

export async function updateClientSettings(client: ClientRow, input: ClientSettingsInput) {
  return db
    .update("clients", client, {
      minimumDurationMinutes: input.minimumDurationMinutes,
      travelTimeMinutes: input.travelTimeMinutes,
    })
    .committed;
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

  const startsAt = args.draft.guaranteedStartAt;
  const endsAt = args.draft.guaranteedStartAt + args.draft.durationMinutes * 60 * 1000;

  const sessionWrite = db.create(
    "sessions",
    {
      startsAt,
      guaranteedStartAt: args.draft.guaranteedStartAt,
      earliestStartAt: undefined,
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
        startsAt,
        endsAt,
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
        label: sessionLabel,
        lastUsedAt: Date.now(),
      },
      { in: args.client },
    )
    .committed;

  return session;
}

async function findProviderBusyWindow(provider: ProviderRow, originRef: string, kind: "block" | "session") {
  const busyRows = await db.query("publicBusyWindows", { in: provider, index: "byStart", order: "asc" });
  return busyRows.find((row) => row.fields.originRef === originRef && row.fields.kind === kind);
}

export async function cancelSession(provider: ProviderRow, session: SessionRow) {
  await db.update("sessions", session, { status: "canceled" }).committed;
  const busyRow = await findProviderBusyWindow(provider, session.id, "session");
  if (busyRow) {
    await db.update("publicBusyWindows", busyRow, { kind: "inactive" }).committed;
  }
}

export async function createPersonalBlock(args: {
  provider: ProviderRow;
  startsAt: number;
  endsAt: number;
  label?: string;
}) {
  const label = args.label ?? "Personal block";
  const blockWrite = db.create(
    "personalBlocks",
    {
      startsAt: args.startsAt,
      endsAt: args.endsAt,
      source: "manual",
      label,
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
        label,
      },
      { in: args.provider },
    )
    .committed;

  return block;
}

export async function updatePersonalBlock(args: {
  provider: ProviderRow;
  block: BlockRow;
  startsAt: number;
  endsAt: number;
  label?: string;
}) {
  const label = args.label ?? args.block.fields.label ?? "Personal block";
  const block = await db
    .update("personalBlocks", args.block, {
      startsAt: args.startsAt,
      endsAt: args.endsAt,
      label,
    })
    .committed;

  const busyRow = await findProviderBusyWindow(args.provider, args.block.id, "block");
  if (busyRow) {
    await db
      .update("publicBusyWindows", busyRow, {
        startsAt: args.startsAt,
        endsAt: args.endsAt,
        label,
      })
      .committed;
  }

  return block;
}

export async function deactivatePersonalBlock(provider: ProviderRow, block: BlockRow) {
  await db.update("personalBlocks", block, { source: "inactive" }).committed;
  const busyRow = await findProviderBusyWindow(provider, block.id, "block");
  if (busyRow) {
    await db.update("publicBusyWindows", busyRow, { kind: "inactive" }).committed;
  }
}

export async function createBaseAvailabilityWindow(args: {
  provider: ProviderRow;
  weekday: number;
  startMinutes: number;
  endMinutes: number;
}) {
  return db
    .create(
      "baseAvailabilityWindows",
      {
        weekday: args.weekday,
        startMinutes: args.startMinutes,
        endMinutes: args.endMinutes,
        status: "active",
        sortKey: args.weekday * 1000 + args.startMinutes,
      },
      { in: args.provider },
    )
    .committed;
}

export async function updateBaseAvailabilityWindow(
  window: BaseAvailabilityRow,
  input: { startMinutes: number; endMinutes: number },
) {
  return db
    .update("baseAvailabilityWindows", window, {
      startMinutes: input.startMinutes,
      endMinutes: input.endMinutes,
      status: "active",
      sortKey: window.fields.weekday * 1000 + input.startMinutes,
    })
    .committed;
}

export async function deactivateBaseAvailabilityWindow(window: BaseAvailabilityRow) {
  return db.update("baseAvailabilityWindows", window, { status: "inactive" }).committed;
}
