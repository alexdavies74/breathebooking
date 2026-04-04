import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import type { RowHandle } from "@vennbase/core";
import type { UseSessionResult } from "@vennbase/react";
import { useSavedRow } from "@vennbase/react";
import { buildClientHomePath, loadClientAccessList, type ClientWorkspaceAccess } from "../lib/clientAccess";
import { db } from "../lib/db";
import type { Schema } from "../lib/schema";
import { LandingRoute } from "./LandingRoute";

interface HomeRouteProps {
  session: UseSessionResult;
}

export function HomeRoute({ session }: HomeRouteProps) {
  const savedProvider = useSavedRow<Schema, "providers">(db, {
    key: "active-provider",
    collection: "providers",
    enabled: Boolean(session.session?.signedIn),
  });
  const [clientAccessList, setClientAccessList] = useState<ClientWorkspaceAccess[] | null>(null);

  useEffect(() => {
    if (!session.session?.signedIn) {
      setClientAccessList([]);
      return;
    }

    let isCancelled = false;

    void loadClientAccessList().then((nextClientAccessList) => {
      if (!isCancelled) {
        setClientAccessList(nextClientAccessList);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [session.session?.signedIn]);

  if (!session.session?.signedIn) {
    return <LandingRoute session={session} />;
  }

  if (savedProvider.status === "loading" || clientAccessList === null) {
    return (
      <div className="panel">
        <h1>Opening workspace…</h1>
      </div>
    );
  }

  if (savedProvider.data) {
    return <Navigate replace to="/provider" />;
  }

  if (clientAccessList.length === 1) {
    return <Navigate replace to={buildClientHomePath(clientAccessList[0])} />;
  }

  if (clientAccessList.length > 1) {
    return (
      <div className="stack">
        <section className="panel panel--wide">
          <p className="eyebrow">Choose workspace</p>
          <h1>Select a client booking home</h1>
          <p>Your account is linked to more than one provider workspace. Choose the relationship you want to open.</p>
        </section>

        <section className="stack">
          {clientAccessList.map((access) => (
            <div className="summary-card" key={`${access.clientBaseUrl}:${access.clientId}`}>
              <span className="eyebrow">{access.providerName}</span>
              <strong>{access.clientName}</strong>
              <p>Open this relationship-specific booking view.</p>
              <div className="row-actions">
                <Link className="button" to={buildClientHomePath(access)}>
                  Open booking home
                </Link>
              </div>
            </div>
          ))}
        </section>
      </div>
    );
  }

  return <LandingRoute session={session} />;
}
