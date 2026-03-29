import { Link, Route, Routes } from "react-router-dom";
import { useSession } from "@vennbase/react";
import { db } from "../lib/db";
import { ClientHomeRoute } from "../routes/ClientHomeRoute";
import { InviteRoute } from "../routes/InviteRoute";
import { LandingRoute } from "../routes/LandingRoute";
import { ProviderClientSettingsRoute } from "../routes/ProviderClientSettingsRoute";
import { ProviderDashboardRoute } from "../routes/ProviderDashboardRoute";

export function App() {
  const session = useSession(db);

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" to="/">
          Breathe Booking
        </Link>
        <nav className="topbar__nav">
          <Link to="/provider">Provider</Link>
          <Link to="/invite">Invite</Link>
        </nav>
      </header>

      <main className="app-content">
        {session.status === "loading" ? (
          <div className="panel">
            <h1>Checking session…</h1>
          </div>
        ) : (
          <Routes>
            <Route path="/" element={<LandingRoute session={session} />} />
            <Route path="/provider" element={<ProviderDashboardRoute session={session} />} />
            <Route path="/provider/clients/:clientId/settings" element={<ProviderClientSettingsRoute session={session} />} />
            <Route path="/invite" element={<InviteRoute session={session} />} />
            <Route path="/client/:clientId" element={<ClientHomeRoute session={session} />} />
          </Routes>
        )}
      </main>
    </div>
  );
}
