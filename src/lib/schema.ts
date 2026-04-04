import { collection, defineSchema, field } from "@vennbase/core";

export const schema = defineSchema({
  providers: collection({
    fields: {
      displayName: field.string(),
      timezone: field.string(),
      ownerUsername: field.string(),
      defaultWeekHorizon: field.number(),
      bookingSubmitterLink: field.string().optional(),
      privateRootRef: field.ref("providerPrivateRoots").optional(),
    },
  }),
  providerPrivateRoots: collection({
    fields: {
      providerRef: field.ref("providers").optional(),
      createdAt: field.number(),
    },
  }),
  bookingRoots: collection({
    fields: {
      providerRef: field.ref("providers").optional(),
      createdAt: field.number(),
    },
  }),
  baseAvailabilityWindows: collection({
    in: ["providers"],
    fields: {
      weekday: field.number(),
      startMinutes: field.number(),
      endMinutes: field.number(),
      status: field.string(),
      sortKey: field.number().indexKey(),
    },
  }),
  clients: collection({
    in: ["providerPrivateRoots"],
    fields: {
      fullName: field.string().indexKey(),
      providerViewerLink: field.string(),
      status: field.string(),
      minimumDurationMinutes: field.number(),
      travelTimeMinutes: field.number(),
      travelBeforeMin: field.number().optional(),
      travelBeforeMax: field.number().optional(),
      travelAfterMin: field.number().optional(),
      travelAfterMax: field.number().optional(),
      earlyStartEnabled: field.boolean().optional(),
    },
  }),
  personalBlocks: collection({
    in: ["providerPrivateRoots"],
    fields: {
      startsAt: field.number().indexKey(),
      endsAt: field.number(),
      source: field.string(),
      label: field.string().optional(),
    },
  }),
  bookings: collection({
    in: ["bookingRoots"],
    fields: {
      clientRef: field.ref("clients"),
      startsAt: field.number().indexKey(),
      endsAt: field.number().indexKey(),
      guaranteedStartAt: field.number(),
      earliestStartAt: field.number().optional(),
      durationMinutes: field.number(),
      status: field.string(),
      bookedByRole: field.string(),
      slotLabel: field.string(),
    },
  }),
  bookingBlocks: collection({
    in: ["bookingRoots"],
    fields: {
      startsAt: field.number().indexKey(),
      endsAt: field.number().indexKey(),
      source: field.string(),
      originRef: field.string(),
      label: field.string().optional(),
    },
  }),
  rebookingPresets: collection({
    in: ["user"],
    fields: {
      clientRef: field.ref("clients").indexKey(),
      weekday: field.number(),
      startMinutes: field.number(),
      durationMinutes: field.number(),
      label: field.string(),
      lastUsedAt: field.number().indexKey(),
      earliestStartMinutes: field.number().optional(),
    },
  }),
  savedBookings: collection({
    in: ["user"],
    fields: {
      clientRef: field.ref("clients").indexKey(),
      bookingRef: field.ref("bookings"),
      status: field.string(),
      startsAt: field.number().indexKey(),
      endsAt: field.number().indexKey(),
      guaranteedStartAt: field.number(),
      earliestStartAt: field.number().optional(),
      durationMinutes: field.number(),
      bookedByRole: field.string(),
      slotLabel: field.string(),
    },
  }),
});

export type Schema = typeof schema;
