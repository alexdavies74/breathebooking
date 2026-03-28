import type { SyncConflict } from "./types";

export interface CalendarSyncAdapter {
  getStatus(): Promise<{ enabled: boolean; lastSyncedAt?: number }>;
  sync(range: { start: number; end: number }): Promise<{ created: number; conflicts: SyncConflict[] }>;
  listConflicts(): Promise<SyncConflict[]>;
}

export const manualCalendarSyncAdapter: CalendarSyncAdapter = {
  async getStatus() {
    return { enabled: false };
  },
  async sync() {
    return { created: 0, conflicts: [] };
  },
  async listConflicts() {
    return [];
  },
};
