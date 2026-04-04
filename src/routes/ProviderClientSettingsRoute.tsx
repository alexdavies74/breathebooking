import { useEffect, useMemo, useState } from "react";
import type { UseSessionResult } from "@vennbase/react";
import { useCurrentUser, useQuery, useRow, useSavedRow, useShareLink } from "@vennbase/react";
import QRCode from "qrcode";
import { useParams } from "react-router-dom";
import { updateClientSettings } from "../domain/actions";
import { db } from "../lib/db";
import type { Schema } from "../lib/schema";

interface ProviderClientSettingsRouteProps {
  session: UseSessionResult;
}

export function ProviderClientSettingsRoute({ session }: ProviderClientSettingsRouteProps) {
  const { clientId } = useParams();
  const currentUser = useCurrentUser(db, { enabled: Boolean(session.session?.signedIn) });
  const savedProvider = useSavedRow<Schema, "providers">(db, {
    key: "active-provider",
    collection: "providers",
    enabled: Boolean(session.session?.signedIn),
  });
  const provider = savedProvider.data ?? null;
  const privateRoot = useRow<Schema, "providerPrivateRoots">(db, provider?.fields.privateRootRef ?? undefined);
  const providerClients = useQuery(
    db,
    "clients",
    privateRoot.data ? { in: privateRoot.data.ref, orderBy: "fullName", order: "asc" } : null,
  );
  const client = clientId ? (providerClients.rows ?? []).find((row) => row.id === clientId) ?? null : null;
  const inviteLink = useShareLink(db, client?.ref, "viewer", { enabled: Boolean(client) });

  const [minimumDurationMinutes, setMinimumDurationMinutes] = useState(180);
  const [travelTimeMinutes, setTravelTimeMinutes] = useState(30);
  const [inviteQr, setInviteQr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!client) {
      return;
    }

    setMinimumDurationMinutes(client.fields.minimumDurationMinutes);
    setTravelTimeMinutes(client.fields.travelTimeMinutes);
  }, [client]);

  useEffect(() => {
    if (!inviteLink.shareLink) {
      setInviteQr(null);
      return;
    }

    const url = new URL(inviteLink.shareLink);
    url.pathname = "/invite";
    url.searchParams.set("clientId", client?.id ?? "");
    url.searchParams.set("clientName", client?.fields.fullName ?? "");
    url.searchParams.set("providerName", provider?.fields.displayName ?? "");

    void QRCode.toDataURL(url.toString(), { margin: 1, width: 240 }).then(setInviteQr);
  }, [client?.fields.fullName, client?.id, inviteLink.shareLink, provider?.fields.displayName]);

  const resolvedInviteLink = useMemo(() => {
    if (!inviteLink.shareLink || !client) {
      return null;
    }

    const url = new URL(inviteLink.shareLink);
    url.pathname = "/invite";
    url.searchParams.set("clientId", client.id);
    url.searchParams.set("clientName", client.fields.fullName);
    url.searchParams.set("providerName", provider?.fields.displayName ?? "");
    return url.toString();
  }, [client, inviteLink.shareLink, provider?.fields.displayName]);

  if (!session.session?.signedIn) {
    return (
      <div className="panel">
        <h1>Client settings</h1>
        <p>Sign in with Puter to manage client settings.</p>
        <button className="button" onClick={() => void session.signIn()} type="button">
          Sign in
        </button>
      </div>
    );
  }

  const isLoadingAccess =
    currentUser.status === "loading" ||
    savedProvider.status === "loading" ||
    privateRoot.status === "loading" ||
    providerClients.status === "loading";
  const isProviderOwner = Boolean(provider && currentUser.data?.username === provider.fields.ownerUsername);
  const isClientChildOfProvider = Boolean(client);

  if (isLoadingAccess) {
    return (
      <div className="panel panel--wide">
        <p className="eyebrow">Client settings</p>
        <h1>Checking access…</h1>
      </div>
    );
  }

  if (!provider || !client || !isProviderOwner || !isClientChildOfProvider) {
    return (
      <div className="panel panel--wide">
        <p className="eyebrow">Client settings</p>
        <h1>Access denied</h1>
        <p>Only the provider who owns this workspace can edit this client’s scheduling settings.</p>
      </div>
    );
  }

  return (
    <div className="panel panel--wide">
      <p className="eyebrow">Client settings</p>
      <h1>{client.fields.fullName}</h1>
      <div className="stack-sm">
        <label className="field">
          <span>Minimum visit</span>
          <select
            value={minimumDurationMinutes}
            onChange={(event) => setMinimumDurationMinutes(Number(event.target.value))}
          >
            {[120, 180, 240, 360, 480].map((value) => (
              <option key={value} value={value}>
                {value / 60}h
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Travel time</span>
          <input
            min={0}
            step={5}
            type="number"
            value={travelTimeMinutes}
            onChange={(event) => setTravelTimeMinutes(Number(event.target.value))}
          />
        </label>
        {resolvedInviteLink ? (
          <div className="invite-card">
            <span className="eyebrow">Invite link</span>
            <a href={resolvedInviteLink}>{resolvedInviteLink}</a>
            <button className="button button--ghost" onClick={() => navigator.clipboard.writeText(resolvedInviteLink)} type="button">
              Copy link
            </button>
            {inviteQr ? <img alt="Invite QR code" className="qr-code" src={inviteQr} /> : null}
          </div>
        ) : null}
        {status ? <div className="status-banner">{status}</div> : null}
        <div className="row-actions">
          <button
            className="button"
            onClick={async () => {
              try {
                await updateClientSettings(client, {
                  minimumDurationMinutes,
                  travelTimeMinutes,
                });
                setStatus("Client settings saved.");
              } catch (error) {
                setStatus("Could not save client settings.");
              }
            }}
            type="button"
          >
            Save settings
          </button>
          <a className="button button--ghost" href="/provider">
            Back to provider
          </a>
        </div>
      </div>
    </div>
  );
}
