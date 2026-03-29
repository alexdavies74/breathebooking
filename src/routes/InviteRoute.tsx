import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { UseSessionResult } from "@vennbase/react";
import { useAcceptInviteFromUrl } from "@vennbase/react";
import { buildClientHomePath } from "../lib/clientAccess";
import { db } from "../lib/db";

interface InviteRouteProps {
  session: UseSessionResult;
}

export function InviteRoute({ session }: InviteRouteProps) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const clientId = searchParams.get("clientId");
  const clientName = searchParams.get("clientName");
  const providerName = searchParams.get("providerName");

  const accept = useAcceptInviteFromUrl(db, {
    enabled: Boolean(session.session?.signedIn && clientId),
    onOpen: async (provider) => {
      navigate(
        buildClientHomePath({
          clientId: clientId!,
          providerId: provider.id,
          providerBaseUrl: provider.ref.baseUrl,
        }),
      );
    },
  });

  const message = useMemo(() => {
    if (!clientId) {
      return "This invite link is missing a client target.";
    }

    if (!session.session?.signedIn) {
      return "Create your account with Puter to unlock your booking home.";
    }

    if (accept.status === "loading") {
      return "Opening your shared booking workspace…";
    }

    if (accept.status === "error") {
      return "The invite could not be accepted. Retry sign-in and try the link again.";
    }

    return "Accepting your invite now.";
  }, [accept.status, clientId, session.session?.signedIn]);

  return (
    <div className="invite-page">
      <div className="panel panel--wide">
        <p className="eyebrow">Invite</p>
        <h1>{providerName ?? "Your provider"} invited you to book care online.</h1>
        <p>{clientName ? `${clientName}, your account opens directly into your booking home.` : message}</p>

        {!session.session?.signedIn ? (
          <button className="button" onClick={() => void session.signIn()} type="button">
            Create account with Puter
          </button>
        ) : (
          <div className="status-banner">{message}</div>
        )}
      </div>
    </div>
  );
}
