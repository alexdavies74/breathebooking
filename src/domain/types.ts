import type { RowRef } from "@vennbase/core";

export type Role = "provider" | "client";

export type WeekBlockState =
  | "available"
  | "maybe"
  | "booked-own"
  | "booked-other"
  | "blocked";

export interface WeekBlock {
  id: string;
  dayKey: string;
  startsAt: number;
  endsAt: number;
  state: WeekBlockState;
  interactive: boolean;
  label?: string;
  guaranteedStartAt?: number;
  earliestStartAt?: number;
  sessionRef?: RowRef<"sessions">;
}

export interface SlotShape {
  weekday: number;
  startMinutes: number;
  durationMinutes: number;
  earliestStartMinutes?: number;
}

export interface BookingDraft {
  startsAt: number;
  guaranteedStartAt: number;
  earliestStartAt?: number;
  endsAt: number;
  durationMinutes: number;
  dayKey: string;
  sourceBlockId: string;
}

export interface SyncConflict {
  id: string;
  message: string;
}

export interface ProviderSummary {
  id: string;
  displayName: string;
  timezone: string;
  defaultWeekHorizon: number;
}

export interface ClientSummary {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  address: string;
  status: string;
  minimumDurationMinutes: number;
  travelBeforeMin: number;
  travelBeforeMax: number;
  travelAfterMin: number;
  travelAfterMax: number;
  earlyStartEnabled: boolean;
}
