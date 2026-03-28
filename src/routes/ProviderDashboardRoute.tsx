import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import type { RowHandle } from "@vennbase/core";
import type { UseSessionResult } from "@vennbase/react";
import { useCurrentUser, useQuery, useSavedRow } from "@vennbase/react";
import {
  createClientInvite,
  createPersonalBlock,
  createPractice,
  updateBaseAvailabilityWindow,
} from "../domain/actions";
import { buildProviderWeekBlocks } from "../domain/availability";
import { manualCalendarSyncAdapter } from "../domain/calendarSync";
import { formatTime, minutesFromTimestamp, timestampFromDayAndMinutes } from "../domain/date";
import { RangeEditor } from "../components/RangeEditor";
import { WeekView } from "../components/WeekView";
import { db } from "../lib/db";
import type { Schema } from "../lib/schema";

interface ProviderDashboardRouteProps {
  session: UseSessionResult;
}

const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
];

export function ProviderDashboardRoute({ session }: ProviderDashboardRouteProps) {
  const currentUser = useCurrentUser(db, { enabled: Boolean(session.session?.signedIn) });
  const savedProvider = useSavedRow<Schema, RowHandle<Schema, "providers">>(db, {
    key: "active-provider",
    enabled: Boolean(session.session?.signedIn),
  });
  const provider = savedProvider.data ?? null;
  const [calendarStatus, setCalendarStatus] = useState("Calendar sync is stubbed for v1.");
  const availability = useQuery(
    db,
    "baseAvailabilityWindows",
    provider ? { in: provider.ref, index: "byWeekday", order: "asc" } : null,
  );
  const clients = useQuery(db, "clients", provider ? { in: provider.ref, index: "byName", order: "asc" } : null);
  const personalBlocks = useQuery(
    db,
    "personalBlocks",
    provider ? { in: provider.ref, index: "byStart", order: "asc" } : null,
  );
  const sessions = useQuery(
    db,
    "sessions",
    clients.rows.length > 0 ? { in: clients.rows.map((client) => client.ref), index: "byStart", order: "asc" } : null,
  );

  const [practiceName, setPracticeName] = useState("");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteQr, setInviteQr] = useState<string | null>(null);
  const [createPracticeStatus, setCreatePracticeStatus] = useState<string | null>(null);
  const [availabilityStatus, setAvailabilityStatus] = useState<string | null>(null);
  const [availabilityDrafts, setAvailabilityDrafts] = useState<Record<string, { startMinutes: number; endMinutes: number }>>({});
  const [clientForm, setClientForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    address: "",
    minimumDurationMinutes: 180,
    travelBeforeMin: 20,
    travelBeforeMax: 40,
    travelAfterMin: 10,
    travelAfterMax: 20,
    earlyStartEnabled: true,
    allowedWeekdays: [1, 2, 3, 4, 5],
    dayWindows: {
      1: { startMinutes: 9 * 60, endMinutes: 13 * 60, earliestStartMinutes: 8 * 60 + 30 },
      2: { startMinutes: 9 * 60, endMinutes: 13 * 60, earliestStartMinutes: 8 * 60 + 30 },
      3: { startMinutes: 9 * 60, endMinutes: 13 * 60, earliestStartMinutes: 8 * 60 + 30 },
      4: { startMinutes: 9 * 60, endMinutes: 13 * 60, earliestStartMinutes: 8 * 60 + 30 },
      5: { startMinutes: 9 * 60, endMinutes: 13 * 60, earliestStartMinutes: 8 * 60 + 30 },
    } as Record<number, { startMinutes: number; endMinutes: number; earliestStartMinutes?: number }>,
  });
  const [blockDraft, setBlockDraft] = useState({
    weekday: 1,
    startMinutes: 12 * 60,
    endMinutes: 14 * 60,
    label: "Personal errand",
  });

  const blocks = useMemo(() => {
    return buildProviderWeekBlocks({
      baseAvailability: availability.rows,
      personalBlocks: personalBlocks.rows,
      sessions: sessions.rows,
      horizonDays: 7,
    });
  }, [availability.rows, personalBlocks.rows, sessions.rows]);

  useEffect(() => {
    if (!provider && currentUser.data?.username) {
      setPracticeName(`${currentUser.data.username}'s care practice`);
    }
  }, [currentUser.data?.username, provider]);

  useEffect(() => {
    if (!inviteLink) {
      setInviteQr(null);
      return;
    }

    void QRCode.toDataURL(inviteLink, { margin: 1, width: 240 }).then(setInviteQr);
  }, [inviteLink]);

  useEffect(() => {
    void manualCalendarSyncAdapter.getStatus().then((status) => {
      setCalendarStatus(status.enabled ? "Calendar sync connected." : "Calendar sync is stubbed for v1.");
    });
  }, []);

  useEffect(() => {
    setAvailabilityDrafts((current) => {
      const next = { ...current };
      let changed = false;

      availability.rows.forEach((row) => {
        if (!next[row.id]) {
          next[row.id] = {
            startMinutes: row.fields.startMinutes,
            endMinutes: row.fields.endMinutes,
          };
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [availability.rows]);

  useEffect(() => {
    console.info("[breathe debug] provider-dashboard:state", {
      signedIn: session.session?.signedIn ?? false,
      savedProviderStatus: savedProvider.status,
      hasProvider: Boolean(provider),
      savedProviderError: savedProvider.error,
      savedProviderRefreshError: savedProvider.refreshError,
      currentUserStatus: currentUser.status,
      currentUsername: currentUser.data?.username,
    });
  }, [
    currentUser.data?.username,
    currentUser.status,
    provider,
    savedProvider.error,
    savedProvider.refreshError,
    savedProvider.status,
    session.session?.signedIn,
  ]);

  if (!session.session?.signedIn) {
    return (
      <div className="panel">
        <h1>Provider dashboard</h1>
        <p>Sign in with Puter to create a practice and manage client bookings.</p>
        <button className="button" onClick={() => void session.signIn()} type="button">
          Sign in
        </button>
      </div>
    );
  }

  if (!provider) {
    return (
      <div className="panel panel--wide">
        <p className="eyebrow">Set up practice</p>
        <h1>Create your provider workspace</h1>
        <label className="field">
          <span>Display name</span>
          <input value={practiceName} onChange={(event) => setPracticeName(event.target.value)} />
        </label>
        {createPracticeStatus ? <div className="status-banner">{createPracticeStatus}</div> : null}
        <button
          className="button"
          onClick={async () => {
            const nextPracticeName = practiceName || "Breathe Practice";
            const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            console.info("[breathe debug] provider-dashboard:create-practice-click", {
              nextPracticeName,
              timezone,
              signedIn: session.session?.signedIn ?? false,
              hasProviderBeforeCreate: Boolean(provider),
              currentUsername: currentUser.data?.username,
            });
            setCreatePracticeStatus("Creating practice. Check the console for debug logs.");

            try {
              const nextProvider = await createPractice(nextPracticeName, timezone);
              console.info("[breathe debug] provider-dashboard:create-practice-success", {
                providerId: nextProvider.id,
              });
              await savedProvider.save(nextProvider);
              setCreatePracticeStatus(`Create practice succeeded for ${nextPracticeName}.`);
            } catch (error) {
              console.error("[breathe debug] provider-dashboard:create-practice-failed", error);
              setCreatePracticeStatus("Create practice failed. Open the console and send me the error.");
            }
          }}
          type="button"
        >
          Create practice
        </button>
      </div>
    );
  }

  return (
    <div className="page-grid">
      <section className="panel panel--wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Provider dashboard</p>
            <h1>{provider.fields.displayName}</h1>
          </div>
          <div className="sync-pill">Manual sync only · {calendarStatus}</div>
        </div>

        <WeekView role="provider" blocks={blocks} />
      </section>

      <aside className="stack">
        <section className="panel">
          <p className="eyebrow">Base availability</p>
          <h2>Adjust your weekly template</h2>
          <p>These drag handles edit the default windows your clients inherit before client-specific narrowing and manual blocks.</p>
          {availabilityStatus ? <div className="status-banner">{availabilityStatus}</div> : null}
          <div className="stack-sm">
            {availability.rows.map((row, index) => {
              const draft = availabilityDrafts[row.id] ?? {
                startMinutes: row.fields.startMinutes,
                endMinutes: row.fields.endMinutes,
              };
              const weekdayLabel = WEEKDAYS.find((weekday) => weekday.value === row.fields.weekday)?.label ?? "Day";
              const windowLabel = index > 0 && availability.rows[index - 1]?.fields.weekday === row.fields.weekday ? "Window 2" : "Window 1";

              return (
                <div className="range-card" key={row.id}>
                  <span className="eyebrow">
                    {weekdayLabel} · {windowLabel}
                  </span>
                  <RangeEditor
                    minMinutes={6 * 60}
                    maxMinutes={22 * 60}
                    step={30}
                    minDurationMinutes={60}
                    startMinutes={draft.startMinutes}
                    endMinutes={draft.endMinutes}
                    onChange={(next) =>
                      setAvailabilityDrafts((current) => ({
                        ...current,
                        [row.id]: {
                          startMinutes: next.startMinutes,
                          endMinutes: next.endMinutes,
                        },
                      }))
                    }
                  />
                  <button
                    className="button button--ghost"
                    onClick={async () => {
                      try {
                        await updateBaseAvailabilityWindow(row, draft);
                        setAvailabilityStatus(`Saved ${weekdayLabel.toLowerCase()} availability.`);
                      } catch (error) {
                        console.error("[breathe debug] provider-dashboard:update-base-availability-failed", error);
                        setAvailabilityStatus(`Could not save ${weekdayLabel.toLowerCase()} availability.`);
                      }
                    }}
                    type="button"
                  >
                    Save window
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel">
          <p className="eyebrow">New client</p>
          <h2>Generate invite link</h2>
          <div className="stack-sm">
            <label className="field">
              <span>Name</span>
              <input
                value={clientForm.fullName}
                onChange={(event) => setClientForm((current) => ({ ...current, fullName: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>Email</span>
              <input
                value={clientForm.email}
                onChange={(event) => setClientForm((current) => ({ ...current, email: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>Phone</span>
              <input
                value={clientForm.phone}
                onChange={(event) => setClientForm((current) => ({ ...current, phone: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>Address</span>
              <input
                value={clientForm.address}
                onChange={(event) => setClientForm((current) => ({ ...current, address: event.target.value }))}
              />
            </label>

            <div className="split-grid">
              <label className="field">
                <span>Minimum visit</span>
                <select
                  value={clientForm.minimumDurationMinutes}
                  onChange={(event) =>
                    setClientForm((current) => ({ ...current, minimumDurationMinutes: Number(event.target.value) }))
                  }
                >
                  {[120, 180, 240, 360, 480].map((value) => (
                    <option key={value} value={value}>
                      {value / 60}h
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Flex arrival</span>
                <select
                  value={String(clientForm.earlyStartEnabled)}
                  onChange={(event) =>
                    setClientForm((current) => ({ ...current, earlyStartEnabled: event.target.value === "true" }))
                  }
                >
                  <option value="true">On</option>
                  <option value="false">Off</option>
                </select>
              </label>
            </div>

            <div className="split-grid">
              <label className="field">
                <span>Travel before min</span>
                <input
                  type="number"
                  step={5}
                  value={clientForm.travelBeforeMin}
                  onChange={(event) =>
                    setClientForm((current) => ({ ...current, travelBeforeMin: Number(event.target.value) }))
                  }
                />
              </label>
              <label className="field">
                <span>Travel before max</span>
                <input
                  type="number"
                  step={5}
                  value={clientForm.travelBeforeMax}
                  onChange={(event) =>
                    setClientForm((current) => ({ ...current, travelBeforeMax: Number(event.target.value) }))
                  }
                />
              </label>
            </div>

            <div className="chip-row">
              {WEEKDAYS.map((weekday) => (
                <button
                  key={weekday.value}
                  className={`chip ${clientForm.allowedWeekdays.includes(weekday.value) ? "chip--active" : ""}`}
                  onClick={() =>
                    setClientForm((current) => ({
                      ...current,
                      allowedWeekdays: current.allowedWeekdays.includes(weekday.value)
                        ? current.allowedWeekdays.filter((value) => value !== weekday.value)
                        : [...current.allowedWeekdays, weekday.value].sort(),
                    }))
                  }
                  type="button"
                >
                  {weekday.label}
                </button>
              ))}
            </div>

            {clientForm.allowedWeekdays.map((weekday) => {
              const window = clientForm.dayWindows[weekday];
              return (
                <div className="range-card" key={weekday}>
                  <span className="eyebrow">{WEEKDAYS.find((item) => item.value === weekday)?.label}</span>
                  <RangeEditor
                    minMinutes={7 * 60}
                    maxMinutes={20 * 60}
                    step={30}
                    minDurationMinutes={clientForm.minimumDurationMinutes}
                    startMinutes={window.startMinutes}
                    endMinutes={window.endMinutes}
                    earliestStartMinutes={window.earliestStartMinutes}
                    allowEarlyStart={clientForm.earlyStartEnabled}
                    onChange={(next) =>
                      setClientForm((current) => ({
                        ...current,
                        dayWindows: {
                          ...current.dayWindows,
                          [weekday]: {
                            startMinutes: next.startMinutes,
                            endMinutes: next.endMinutes,
                            earliestStartMinutes: next.earliestStartMinutes,
                          },
                        },
                      }))
                    }
                  />
                </div>
              );
            })}

            <button
              className="button"
              onClick={async () => {
                const result = await createClientInvite(provider, clientForm);
                setInviteLink(result.inviteLink);
              }}
              type="button"
            >
              Generate invite link
            </button>
          </div>

          {inviteLink ? (
            <div className="invite-card">
              <span className="eyebrow">Invite ready</span>
              <a href={inviteLink}>{inviteLink}</a>
              <button className="button button--ghost" onClick={() => navigator.clipboard.writeText(inviteLink)} type="button">
                Copy link
              </button>
              {inviteQr ? <img alt="Invite QR code" className="qr-code" src={inviteQr} /> : null}
            </div>
          ) : null}
        </section>

        <section className="panel">
          <p className="eyebrow">Personal block</p>
          <h2>Add a block in context</h2>
          <div className="split-grid">
            <label className="field">
              <span>Day</span>
              <select
                value={blockDraft.weekday}
                onChange={(event) => setBlockDraft((current) => ({ ...current, weekday: Number(event.target.value) }))}
              >
                {WEEKDAYS.map((weekday) => (
                  <option key={weekday.value} value={weekday.value}>
                    {weekday.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Label</span>
              <input
                value={blockDraft.label}
                onChange={(event) => setBlockDraft((current) => ({ ...current, label: event.target.value }))}
              />
            </label>
          </div>

          <RangeEditor
            minMinutes={7 * 60}
            maxMinutes={20 * 60}
            step={30}
            minDurationMinutes={30}
            startMinutes={blockDraft.startMinutes}
            endMinutes={blockDraft.endMinutes}
            onChange={(next) =>
              setBlockDraft((current) => ({
                ...current,
                startMinutes: next.startMinutes,
                endMinutes: next.endMinutes,
              }))
            }
          />

          <button
            className="button"
            onClick={async () => {
              const today = new Date();
              const weekday = today.getDay();
              const delta = (blockDraft.weekday - weekday + 7) % 7;
              const targetDay = new Date(today);
              targetDay.setHours(0, 0, 0, 0);
              targetDay.setDate(today.getDate() + delta);
              await createPersonalBlock({
                provider,
                startsAt: timestampFromDayAndMinutes(targetDay.getTime(), blockDraft.startMinutes),
                endsAt: timestampFromDayAndMinutes(targetDay.getTime(), blockDraft.endMinutes),
                label: blockDraft.label,
              });
            }}
            type="button"
          >
            Add personal block
          </button>
        </section>

        <section className="panel">
          <p className="eyebrow">Clients</p>
          <h2>Active roster</h2>
          <div className="stack-sm">
            {clients.rows.map((client) => (
              <div className="summary-card" key={client.id}>
                <strong>{client.fields.fullName}</strong>
                <p>{client.fields.email}</p>
                <p>
                  Minimum {client.fields.minimumDurationMinutes / 60}h · Travel {client.fields.travelBeforeMin}-
                  {client.fields.travelBeforeMax} min
                </p>
                <a className="button button--ghost" href={`/client/${client.id}?providerId=${provider.id}`}>
                  Open client view
                </a>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}
