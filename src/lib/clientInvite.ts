import type { RowHandle } from "@vennbase/core";
import { db } from "./db";
import type { Schema } from "./schema";

type ProviderRow = RowHandle<Schema, "providers">;
type ClientRow = RowHandle<Schema, "clients">;

export function buildClientInviteLink(provider: ProviderRow, client: ClientRow) {
  const shareLinkWrite = db.createShareLink(client.ref, "content-viewer");
  void shareLinkWrite.committed.catch((error) => {
    console.error("Background Vennbase write failed during buildClientInviteLink.", error);
  });

  const url = new URL(shareLinkWrite.value);
  url.pathname = "/invite";
  url.searchParams.set("clientId", client.id);
  url.searchParams.set("clientName", client.fields.fullName);
  url.searchParams.set("providerName", provider.fields.displayName);
  return url.toString();
}
