import { loadPreference, savePreference } from "./puterClient";

const CLIENT_ACCESS_PREFERENCE_KEY = "client-access";

export interface ClientWorkspaceAccess {
  clientId: string;
  clientBaseUrl: string;
  clientName: string;
  providerName: string;
  lastOpenedAt: number;
}

function isClientWorkspaceAccess(value: unknown): value is ClientWorkspaceAccess {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ClientWorkspaceAccess>;
  return (
    typeof candidate.clientId === "string" &&
    typeof candidate.clientBaseUrl === "string" &&
    typeof candidate.clientName === "string" &&
    typeof candidate.providerName === "string" &&
    typeof candidate.lastOpenedAt === "number"
  );
}

function sortByLastOpenedAt(entries: ClientWorkspaceAccess[]) {
  return [...entries].sort((left, right) => right.lastOpenedAt - left.lastOpenedAt);
}

export function buildClientHomePath(access: Pick<ClientWorkspaceAccess, "clientId">) {
  return `/client/${access.clientId}`;
}

export async function loadClientAccessList() {
  const stored = await loadPreference<unknown>(CLIENT_ACCESS_PREFERENCE_KEY);
  if (!Array.isArray(stored)) {
    return [];
  }

  return sortByLastOpenedAt(stored.filter(isClientWorkspaceAccess));
}

export async function findSavedClientAccess(clientId: string) {
  const entries = await loadClientAccessList();
  return entries.find((entry) => entry.clientId === clientId) ?? null;
}

export async function saveClientAccess(
  access: Omit<ClientWorkspaceAccess, "lastOpenedAt"> & { lastOpenedAt?: number },
) {
  const existing = await loadClientAccessList();
  const nextEntry: ClientWorkspaceAccess = {
    ...access,
    lastOpenedAt: access.lastOpenedAt ?? Date.now(),
  };
  const nextEntries = sortByLastOpenedAt([
    nextEntry,
    ...existing.filter(
      (entry) => !(entry.clientId === nextEntry.clientId && entry.clientBaseUrl === nextEntry.clientBaseUrl),
    ),
  ]);

  await savePreference(CLIENT_ACCESS_PREFERENCE_KEY, nextEntries);
  return nextEntries;
}
