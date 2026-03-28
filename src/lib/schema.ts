import { collection, defineSchema, field, index } from "@vennbase/core";

export const schema = defineSchema({
  providers: collection({
    fields: {
      displayName: field.string(),
      timezone: field.string(),
      defaultWeekHorizon: field.number().default(4),
    },
    indexes: {
      byDisplayName: index("displayName"),
    },
  }),
  baseAvailabilityWindows: collection({
    in: ["providers"],
    fields: {
      weekday: field.number(),
      startMinutes: field.number(),
      endMinutes: field.number(),
      sortKey: field.number(),
    },
    indexes: {
      bySortKey: index("sortKey"),
      byWeekday: index(["weekday", "sortKey"]),
    },
  }),
  clients: collection({
    in: ["providers"],
    fields: {
      fullName: field.string(),
      email: field.string(),
      phone: field.string().optional(),
      address: field.string(),
      status: field.string(),
      minimumDurationMinutes: field.number(),
      travelBeforeMin: field.number(),
      travelBeforeMax: field.number(),
      travelAfterMin: field.number(),
      travelAfterMax: field.number(),
      earlyStartEnabled: field.boolean().default(false),
    },
    indexes: {
      byName: index("fullName"),
      byStatus: index("status"),
    },
  }),
  clientAllowedWindows: collection({
    in: ["clients"],
    fields: {
      weekday: field.number(),
      startMinutes: field.number(),
      endMinutes: field.number(),
      earliestStartMinutes: field.number().optional(),
      sortKey: field.number(),
    },
    indexes: {
      byWeekday: index(["weekday", "sortKey"]),
    },
  }),
  sessions: collection({
    in: ["clients"],
    fields: {
      startsAt: field.number(),
      guaranteedStartAt: field.number(),
      earliestStartAt: field.number().optional(),
      durationMinutes: field.number(),
      status: field.string(),
      bookedByRole: field.string(),
      slotLabel: field.string(),
    },
    indexes: {
      byStart: index("startsAt"),
      byStatusStart: index(["status", "startsAt"]),
    },
  }),
  personalBlocks: collection({
    in: ["providers"],
    fields: {
      startsAt: field.number(),
      endsAt: field.number(),
      source: field.string(),
      label: field.string().optional(),
    },
    indexes: {
      byStart: index("startsAt"),
    },
  }),
  publicBusyWindows: collection({
    in: ["providers", "clients"],
    fields: {
      startsAt: field.number(),
      endsAt: field.number(),
      kind: field.string(),
      originRef: field.string(),
      label: field.string().optional(),
    },
    indexes: {
      byStart: index("startsAt"),
      byKindStart: index(["kind", "startsAt"]),
    },
  }),
  rebookingPresets: collection({
    in: ["clients"],
    fields: {
      weekday: field.number(),
      startMinutes: field.number(),
      durationMinutes: field.number(),
      label: field.string(),
      lastUsedAt: field.number(),
      earliestStartMinutes: field.number().optional(),
    },
    indexes: {
      byLastUsedAt: index("lastUsedAt"),
    },
  }),
});

export type Schema = typeof schema;
