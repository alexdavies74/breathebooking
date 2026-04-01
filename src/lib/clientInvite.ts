import type { RowHandle } from "@vennbase/core";
import { db } from "./db";
import type { Schema } from "./schema";

type ProviderRow = RowHandle<Schema, "providers">;
type ClientRow = RowHandle<Schema, "clients">;

export async function buildClientInviteLink(provider: ProviderRow, client: ClientRow) {
  const shareLink = await db.createShareLink(client.ref, "viewer").committed;
  const url = new URL(shareLink);
  url.pathname = "/invite";
  url.searchParams.set("clientId", client.id);
  url.searchParams.set("clientName", client.fields.fullName);
  url.searchParams.set("providerName", provider.fields.displayName);
  return url.toString();
}
