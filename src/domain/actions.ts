import { CURRENT_USER, type RowHandle, type RowRef } from "@vennbase/core";
import { db } from "../lib/db";
import { buildClientInviteLink } from "../lib/clientInvite";
import type { Schema } from "../lib/schema";
import { formatDayLabel, formatTime, minutesFromTimestamp, weekdayFromTimestamp } from "./date";
import type { BookingDraft } from "./types";

type ProviderRow = RowHandle<Schema, "providers">;
type ProviderPrivateRootRow = RowHandle<Schema, "providerPrivateRoots">;
type ClientRow = RowHandle<Schema, "clients">;
type BookingRow = RowHandle<Schema, "bookings">;
type SavedBookingRow = RowHandle<Schema, "savedBookings">;
type BlockRow = RowHandle<Schema, "personalBlocks">;
type BookingBlockRow = RowHandle<Schema, "bookingBlocks">;
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

function bookingRootRefFromProvider(provider: ProviderRow): RowRef<"bookingRoots"> {
  const link = provider.fields.bookingSubmitterLink;
  if (!link) {
    throw new Error("Provider is missing a booking root link.");
  }

  const parsed = db.parseInvite(link);
  if (parsed.ref.collection !== "bookingRoots") {
    throw new Error(`Expected bookingRoots ref, got ${parsed.ref.collection}`);
  }

  return parsed.ref as RowRef<"bookingRoots">;
}

async function fetchProviderPrivateRoot(provider: ProviderRow): Promise<ProviderPrivateRootRow> {
  const privateRootRef = provider.fields.privateRootRef;
  if (!privateRootRef) {
    throw new Error("Provider is missing a private root.");
  }

  const privateRoot = await db.getRow(privateRootRef);
  if (privateRoot.collection !== "providerPrivateRoots") {
    throw new Error(`Expected providerPrivateRoots row, got ${privateRoot.collection}`);
  }

  return privateRoot as ProviderPrivateRootRow;
}

async function assertBookingSlotAvailable(args: {
  bookingRootRef: RowRef<"bookingRoots">;
  startsAt: number;
  endsAt: number;
  excludeBookingId?: string;
}) {
  const existing = await db.query("bookings", {
    in: args.bookingRootRef,
    where: {
      startsAt: args.startsAt,
      endsAt: args.endsAt,
    },
    select: "indexKeys",
    limit: 10,
  });

  if (existing.some((row) => row.id !== args.excludeBookingId)) {
    throw new Error("This slot is no longer available.");
  }
}

function createSavedBookingFields(args: {
  client: ClientRow;
  booking: BookingDraft;
  bookedByRole: "provider" | "client";
  slotLabel: string;
  bookingRef: RowRef<"bookings">;
}) {
  return {
    clientRef: args.client.ref,
    bookingRef: args.bookingRef,
    status: "active",
    startsAt: args.booking.startsAt,
    endsAt: args.booking.endsAt,
    guaranteedStartAt: args.booking.guaranteedStartAt,
    earliestStartAt: args.booking.earliestStartAt,
    durationMinutes: args.booking.durationMinutes,
    bookedByRole: args.bookedByRole,
    slotLabel: args.slotLabel,
  };
}

async function recordPreset(client: ClientRow, booking: BookingDraft, slotLabel: string) {
  await db
    .create(
      "rebookingPresets",
      {
        clientRef: client.ref,
        weekday: weekdayFromTimestamp(booking.guaranteedStartAt),
        startMinutes: minutesFromTimestamp(booking.guaranteedStartAt),
        durationMinutes: booking.durationMinutes,
        label: slotLabel,
        lastUsedAt: Date.now(),
      },
      { in: CURRENT_USER },
    )
    .committed;
}

async function findBookingBlock(bookingRootRef: RowRef<"bookingRoots">, originRef: string) {
  const rows = await db.query("bookingBlocks", {
    in: bookingRootRef,
    orderBy: "startsAt",
    order: "asc",
  });
  return rows.find((row) => row.fields.originRef === originRef) ?? null;
}

export async function createPractice(displayName: string, timezone: string, ownerUsername: string) {
  const providerWrite = db.create("providers", {
    displayName,
    timezone,
    ownerUsername,
    defaultWeekHorizon: 4,
  });
  const provider = providerWrite.value;
  await providerWrite.committed;

  const privateRootWrite = db.create("providerPrivateRoots", {
    providerRef: provider.ref,
    createdAt: Date.now(),
  });
  const privateRoot = privateRootWrite.value;
  await privateRootWrite.committed;

  const bookingRootWrite = db.create("bookingRoots", {
    providerRef: provider.ref,
    createdAt: Date.now(),
  });
  const bookingRoot = bookingRootWrite.value;
  await bookingRootWrite.committed;

  const bookingSubmitterLink = await db.createShareLink(bookingRoot.ref, "submitter").committed;
  const committedProvider = await db
    .update("providers", provider.ref, {
      bookingSubmitterLink,
      privateRootRef: privateRoot.ref,
    })
    .committed;

  await Promise.all(
    DEFAULT_PROVIDER_WINDOWS.map(async (window) => {
      await db.create("baseAvailabilityWindows", window, { in: committedProvider }).committed;
    }),
  );

  return committedProvider;
}

export async function createClient(provider: ProviderRow, input: CreateClientInput) {
  const privateRoot = await fetchProviderPrivateRoot(provider);
  const providerViewerLink = await db.createShareLink(provider.ref, "viewer").committed;

  const client = await db
    .create(
      "clients",
      {
        fullName: input.fullName,
        providerViewerLink,
        status: "active",
        minimumDurationMinutes: 180,
        travelTimeMinutes: 30,
      },
      { in: privateRoot },
    )
    .committed;

  return {
    client,
    inviteLink: await buildClientInviteLink(provider, client),
  };
}

export async function updateClientSettings(client: ClientRow, input: ClientSettingsInput) {
  return db
    .update("clients", client.ref, {
      minimumDurationMinutes: input.minimumDurationMinutes,
      travelTimeMinutes: input.travelTimeMinutes,
    })
    .committed;
}

export async function createBooking(args: {
  bookingRootRef: RowRef<"bookingRoots">;
  client: ClientRow;
  draft: BookingDraft;
  bookedByRole: "provider" | "client";
}) {
  const slotLabel = `${formatDayLabel(args.draft.guaranteedStartAt)} · ${formatTime(args.draft.guaranteedStartAt)}`;

  await assertBookingSlotAvailable({
    bookingRootRef: args.bookingRootRef,
    startsAt: args.draft.startsAt,
    endsAt: args.draft.endsAt,
  });

  const booking = await db
    .create(
      "bookings",
      {
        clientRef: args.client.ref,
        startsAt: args.draft.startsAt,
        endsAt: args.draft.endsAt,
        guaranteedStartAt: args.draft.guaranteedStartAt,
        earliestStartAt: args.draft.earliestStartAt,
        durationMinutes: args.draft.durationMinutes,
        status: "confirmed",
        bookedByRole: args.bookedByRole,
        slotLabel,
      },
      { in: args.bookingRootRef },
    )
    .committed;

  const savedBooking = await db
    .create("savedBookings", createSavedBookingFields({
      client: args.client,
      booking: args.draft,
      bookedByRole: args.bookedByRole,
      slotLabel,
      bookingRef: booking.ref,
    }), {
      in: CURRENT_USER,
    })
    .committed;

  await recordPreset(args.client, args.draft, slotLabel);

  return { booking, savedBooking };
}

export async function updateBooking(args: {
  bookingRootRef: RowRef<"bookingRoots">;
  client: ClientRow;
  savedBooking: SavedBookingRow;
  draft: BookingDraft;
  bookedByRole: "provider" | "client";
}) {
  const slotLabel = `${formatDayLabel(args.draft.guaranteedStartAt)} · ${formatTime(args.draft.guaranteedStartAt)}`;
  const bookingId = args.savedBooking.fields.bookingRef.id;

  await assertBookingSlotAvailable({
    bookingRootRef: args.bookingRootRef,
    startsAt: args.draft.startsAt,
    endsAt: args.draft.endsAt,
    excludeBookingId: bookingId,
  });

  const booking = await db
    .update("bookings", args.savedBooking.fields.bookingRef, {
      clientRef: args.client.ref,
      startsAt: args.draft.startsAt,
      endsAt: args.draft.endsAt,
      guaranteedStartAt: args.draft.guaranteedStartAt,
      earliestStartAt: args.draft.earliestStartAt,
      durationMinutes: args.draft.durationMinutes,
      status: "confirmed",
      bookedByRole: args.bookedByRole,
      slotLabel,
    })
    .committed;

  const savedBooking = await db
    .update("savedBookings", args.savedBooking.ref, createSavedBookingFields({
      client: args.client,
      booking: args.draft,
      bookedByRole: args.bookedByRole,
      slotLabel,
      bookingRef: booking.ref,
    }))
    .committed;

  await recordPreset(args.client, args.draft, slotLabel);

  return { booking, savedBooking };
}

export async function cancelBooking(args: {
  bookingRootRef: RowRef<"bookingRoots">;
  savedBooking: SavedBookingRow;
}) {
  const booking = await db.getRow(args.savedBooking.fields.bookingRef);
  if (booking.collection !== "bookings") {
    throw new Error(`Expected bookings row, got ${booking.collection}`);
  }

  await booking.in.remove(args.bookingRootRef).committed;
  await db.update("savedBookings", args.savedBooking.ref, { status: "canceled" }).committed;
}

export async function createPersonalBlock(args: {
  provider: ProviderRow;
  startsAt: number;
  endsAt: number;
  label?: string;
}) {
  const privateRoot = await fetchProviderPrivateRoot(args.provider);
  const bookingRootRef = bookingRootRefFromProvider(args.provider);
  const label = args.label ?? "Personal block";

  const block = await db
    .create(
      "personalBlocks",
      {
        startsAt: args.startsAt,
        endsAt: args.endsAt,
        source: "manual",
        label,
      },
      { in: privateRoot },
    )
    .committed;

  await db
    .create(
      "bookingBlocks",
      {
        startsAt: args.startsAt,
        endsAt: args.endsAt,
        source: "manual",
        originRef: block.id,
        label,
      },
      { in: bookingRootRef },
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
  const bookingRootRef = bookingRootRefFromProvider(args.provider);
  const label = args.label ?? args.block.fields.label ?? "Personal block";

  const block = await db
    .update("personalBlocks", args.block.ref, {
      startsAt: args.startsAt,
      endsAt: args.endsAt,
      label,
    })
    .committed;

  const bookingBlock = await findBookingBlock(bookingRootRef, args.block.id);
  if (bookingBlock) {
    await db
      .update("bookingBlocks", bookingBlock.ref, {
        startsAt: args.startsAt,
        endsAt: args.endsAt,
        label,
      })
      .committed;
  }

  return block;
}

export async function deactivatePersonalBlock(provider: ProviderRow, block: BlockRow) {
  const bookingRootRef = bookingRootRefFromProvider(provider);
  await db.update("personalBlocks", block.ref, { source: "inactive" }).committed;

  const bookingBlock = await findBookingBlock(bookingRootRef, block.id);
  if (bookingBlock) {
    await bookingBlock.in.remove(bookingRootRef).committed;
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
    .update("baseAvailabilityWindows", window.ref, {
      startMinutes: input.startMinutes,
      endMinutes: input.endMinutes,
      status: "active",
      sortKey: window.fields.weekday * 1000 + input.startMinutes,
    })
    .committed;
}

export async function deactivateBaseAvailabilityWindow(window: BaseAvailabilityRow) {
  return db.update("baseAvailabilityWindows", window.ref, { status: "inactive" }).committed;
}

export async function loadProviderPrivateRoot(provider: ProviderRow) {
  return await fetchProviderPrivateRoot(provider);
}

export function getBookingRootRef(provider: ProviderRow) {
  return bookingRootRefFromProvider(provider);
}

export async function loadBookingBlockRows(bookingRootRef: RowRef<"bookingRoots">) {
  return db.query("bookingBlocks", {
    in: bookingRootRef,
    orderBy: "startsAt",
    order: "asc",
  });
}

export async function loadBookingRows(bookingRootRef: RowRef<"bookingRoots">) {
  return db.query("bookings", {
    in: bookingRootRef,
    orderBy: "startsAt",
    order: "asc",
  });
}
