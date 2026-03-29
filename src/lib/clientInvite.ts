import type { RowHandle } from "@vennbase/core";
import { db } from "./db";
import type { Schema } from "./schema";

type ProviderRow = RowHandle<Schema, "providers">;
type ClientRow = RowHandle<Schema, "clients">;

export function buildClientInviteLink(provider: ProviderRow, client: ClientRow) {
  const token = db.createInviteToken(provider).value;
  const url = new URL(db.createShareLink(provider, token.token));
  url.pathname = "/invite";
  url.searchParams.set("clientId", client.id);
  url.searchParams.set("clientName", client.fields.fullName);
  url.searchParams.set("providerName", provider.fields.displayName);
  return url.toString();
}
