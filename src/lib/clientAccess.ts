import { loadPreference, savePreference } from "./puterClient";

const CLIENT_ACCESS_PREFERENCE_KEY = "client-access";

export interface ClientWorkspaceAccess {
  clientId: string;
  clientName: string;
  providerId: string;
  providerName: string;
  providerBaseUrl: string;
  lastOpenedAt: number;
}

function isClientWorkspaceAccess(value: unknown): value is ClientWorkspaceAccess {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ClientWorkspaceAccess>;
  return (
    typeof candidate.clientId === "string" &&
    typeof candidate.clientName === "string" &&
    typeof candidate.providerId === "string" &&
    typeof candidate.providerName === "string" &&
    typeof candidate.providerBaseUrl === "string" &&
    typeof candidate.lastOpenedAt === "number"
  );
}

function sortByLastOpenedAt(entries: ClientWorkspaceAccess[]) {
  return [...entries].sort((left, right) => right.lastOpenedAt - left.lastOpenedAt);
}

export function buildClientHomePath(access: Pick<ClientWorkspaceAccess, "clientId" | "providerId" | "providerBaseUrl">) {
  const searchParams = new URLSearchParams({
    providerId: access.providerId,
    providerBaseUrl: access.providerBaseUrl,
  });
  return `/client/${access.clientId}?${searchParams.toString()}`;
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
      (entry) =>
        !(
          entry.clientId === nextEntry.clientId &&
          entry.providerId === nextEntry.providerId &&
          entry.providerBaseUrl === nextEntry.providerBaseUrl
        ),
    ),
  ]);

  await savePreference(CLIENT_ACCESS_PREFERENCE_KEY, nextEntries);
  return nextEntries;
}
