import { Link } from "react-router-dom";
import type { UseSessionResult } from "@vennbase/react";

interface LandingRouteProps {
  session: UseSessionResult;
}

export function LandingRoute({ session }: LandingRouteProps) {
  return (
    <div className="hero">
      <div className="hero__copy">
        <p className="eyebrow">Doula Booking</p>
        <h1>Long-form postpartum scheduling without a backend.</h1>
        <p>
          Breathe Booking uses Vennbase for collaborative data and Puter for account identity and lightweight
          app preferences. Providers manage a small roster, and clients book against real relationship-specific
          windows.
        </p>
        <div className="hero__actions">
          {session.session?.signedIn ? (
            <>
              <Link className="button" to="/provider">
                Open provider dashboard
              </Link>
              <Link className="button button--ghost" to="/invite">
                Open invite landing
              </Link>
            </>
          ) : (
            <button className="button" onClick={() => void session.signIn()} type="button">
              Sign in with Puter
            </button>
          )}
        </div>
      </div>
      <div className="hero__panel">
        <div className="stat-card">
          <span className="eyebrow">Core promise</span>
          <strong>No custom backend</strong>
          <p>Client auth, invites, booking state, and slot isolation all stay in the browser app.</p>
        </div>
        <div className="stat-card">
          <span className="eyebrow">Week view</span>
          <strong>3-8 hour visits</strong>
          <p>Designed around meaningful windows instead of dense 15-minute calendar grids.</p>
        </div>
      </div>
    </div>
  );
}
