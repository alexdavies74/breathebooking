import { useEffect, useMemo, useState } from "react";
import type { RowHandle } from "@vennbase/core";
import type { UseSessionResult } from "@vennbase/react";
import { useCurrentUser, useQuery, useRow, useSavedRow } from "@vennbase/react";
import { useNavigate } from "react-router-dom";
import {
  createBaseAvailabilityWindow,
  createClient,
  createPractice,
  createPersonalBlock,
  deactivateBaseAvailabilityWindow,
  deactivatePersonalBlock,
  getBookingRootRef,
  updateBaseAvailabilityWindow,
  updatePersonalBlock,
} from "../domain/actions";
import { buildProviderWeekBlocks } from "../domain/availability";
import { manualCalendarSyncAdapter } from "../domain/calendarSync";
import { clamp, minutesFromTimestamp, timestampFromDayAndMinutes, toDayKey, weekdayFromTimestamp } from "../domain/date";
import type { ProviderEditableKind, ProviderRangeDraft, WeekBlock } from "../domain/types";
import { WeekView } from "../components/WeekView";
import { db } from "../lib/db";
import type { Schema } from "../lib/schema";

interface ProviderDashboardRouteProps {
  session: UseSessionResult;
}

const DEFAULT_AVAILABILITY_DURATION = 120;
const DEFAULT_BLOCK_DURATION = 60;
const DAY_START_MINUTES = 6 * 60;
const DAY_END_MINUTES = 22 * 60;

function createDraftId(kind: ProviderEditableKind, dayKey: string) {
  return `draft-${kind}-${dayKey}-${Date.now()}`;
}

function createDraftFromBlock(block: WeekBlock): ProviderRangeDraft | null {
  if ((block.sourceKind !== "availability" && block.sourceKind !== "personal-block") || !block.sourceId) {
    return null;
  }

  const dayStart = new Date(`${block.dayKey}T00:00:00`).getTime();
  return {
    id: `${block.sourceKind}-${block.sourceId}-${block.dayKey}`,
    sourceKind: block.sourceKind,
    sourceId: block.sourceId,
    dayKey: block.dayKey,
    dayStart,
    weekday: block.weekday ?? weekdayFromTimestamp(dayStart),
    startMinutes: minutesFromTimestamp(block.startsAt),
    endMinutes: minutesFromTimestamp(block.endsAt),
    isNew: false,
  };
}

export function ProviderDashboardRoute({ session }: ProviderDashboardRouteProps) {
  const navigate = useNavigate();
  const currentUser = useCurrentUser(db, { enabled: Boolean(session.session?.signedIn) });
  const savedProvider = useSavedRow<Schema, RowHandle<Schema, "providers">>(db, {
    key: "active-provider",
    enabled: Boolean(session.session?.signedIn),
  });
  const provider = savedProvider.data ?? null;
  const privateRoot = useRow(db, provider?.fields.privateRootRef ?? undefined);
  const bookingRootRef = useMemo(() => {
    if (!provider) {
      return null;
    }

    try {
      return getBookingRootRef(provider);
    } catch {
      return null;
    }
  }, [provider]);
  const [horizonDays, setHorizonDays] = useState(14);
  const [calendarStatus, setCalendarStatus] = useState("Calendar sync is stubbed for v1.");
  const availability = useQuery(
    db,
    "baseAvailabilityWindows",
    provider ? { in: provider.ref, orderBy: "sortKey", order: "asc" } : null,
  );
  const clients = useQuery(
    db,
    "clients",
    privateRoot.data ? { in: privateRoot.data.ref, orderBy: "fullName", order: "asc" } : null,
  );
  const personalBlocks = useQuery(
    db,
    "personalBlocks",
    privateRoot.data ? { in: privateRoot.data.ref, orderBy: "startsAt", order: "asc" } : null,
  );
  const bookings = useQuery(
    db,
    "bookings",
    bookingRootRef ? { in: bookingRootRef, orderBy: "startsAt", order: "asc" } : null,
  );

  const [practiceName, setPracticeName] = useState("");
  const [createPracticeStatus, setCreatePracticeStatus] = useState<string | null>(null);
  const [clientStatus, setClientStatus] = useState<string | null>(null);
  const [providerEditMode, setProviderEditMode] = useState<ProviderEditableKind>("availability");
  const [providerDraft, setProviderDraft] = useState<ProviderRangeDraft | null>(null);
  const [clientName, setClientName] = useState("");

  const blocks = useMemo(() => {
    return buildProviderWeekBlocks({
      baseAvailability: availability.rows ?? [],
      personalBlocks: personalBlocks.rows ?? [],
      bookings: bookings.rows ?? [],
      horizonDays,
    });
  }, [availability.rows, bookings.rows, horizonDays, personalBlocks.rows]);

  const availabilityById = useMemo(
    () => new Map((availability.rows ?? []).map((row) => [row.id, row])),
    [availability.rows],
  );
  const personalBlocksById = useMemo(
    () => new Map((personalBlocks.rows ?? []).map((row) => [row.id, row])),
    [personalBlocks.rows],
  );

  useEffect(() => {
    if (!provider && currentUser.data?.username) {
      setPracticeName(`${currentUser.data.username}'s care practice`);
    }
  }, [currentUser.data?.username, provider]);

  useEffect(() => {
    setProviderDraft(null);
  }, [providerEditMode]);

  useEffect(() => {
    void manualCalendarSyncAdapter.getStatus().then((status) => {
      setCalendarStatus(status.enabled ? "Calendar sync connected." : "Calendar sync is stubbed for v1.");
    });
  }, []);

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
            const ownerUsername = currentUser.data?.username;
            if (!ownerUsername) {
              setCreatePracticeStatus("We could not confirm the signed-in provider username yet.");
              return;
            }

            const nextPracticeName = practiceName || "Breathe Practice";
            const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            setCreatePracticeStatus("Creating practice…");

            try {
              const nextProvider = await createPractice(nextPracticeName, timezone, ownerUsername);
              await savedProvider.save(nextProvider);
              setCreatePracticeStatus(`Create practice succeeded for ${nextPracticeName}.`);
            } catch (error) {
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

  async function persistProviderDraft(
    draftToSave: ProviderRangeDraft,
    options: { clearDraftAfterSave: boolean; announceSuccess: boolean },
  ) {
    const activeProvider = provider;
    if (!activeProvider) {
      return;
    }

    try {
      if (draftToSave.sourceKind === "availability") {
        if (draftToSave.isNew) {
          await createBaseAvailabilityWindow({
            provider: activeProvider,
            weekday: draftToSave.weekday,
            startMinutes: draftToSave.startMinutes,
            endMinutes: draftToSave.endMinutes,
          });
        } else if (draftToSave.sourceId) {
          const window = availabilityById.get(draftToSave.sourceId);
          if (!window) {
            setClientStatus("That availability window is no longer available to edit.");
            return;
          }

          await updateBaseAvailabilityWindow(window, {
            startMinutes: draftToSave.startMinutes,
            endMinutes: draftToSave.endMinutes,
          });
        }
      } else if (draftToSave.isNew) {
        await createPersonalBlock({
          provider: activeProvider,
          startsAt: timestampFromDayAndMinutes(draftToSave.dayStart, draftToSave.startMinutes),
          endsAt: timestampFromDayAndMinutes(draftToSave.dayStart, draftToSave.endMinutes),
        });
      } else if (draftToSave.sourceId) {
        const block = personalBlocksById.get(draftToSave.sourceId);
        if (!block) {
          setClientStatus("That personal block is no longer available to edit.");
          return;
        }

        await updatePersonalBlock({
          provider: activeProvider,
          block,
          startsAt: timestampFromDayAndMinutes(draftToSave.dayStart, draftToSave.startMinutes),
          endsAt: timestampFromDayAndMinutes(draftToSave.dayStart, draftToSave.endMinutes),
        });
      }

      if (options.announceSuccess) {
        setClientStatus(`${draftToSave.sourceKind === "availability" ? "Availability" : "Personal block"} saved.`);
      }

      if (options.clearDraftAfterSave) {
        setProviderDraft((currentDraft) => (currentDraft?.id === draftToSave.id ? null : currentDraft));
      }
    } catch (error) {
      setClientStatus(`Could not save that ${draftToSave.sourceKind === "availability" ? "availability range" : "personal block"}.`);
    }
  }

  async function deleteProviderDraft() {
    const activeProvider = provider;
    if (!activeProvider || !providerDraft || providerDraft.isNew || !providerDraft.sourceId) {
      setProviderDraft(null);
      return;
    }

    try {
      if (providerDraft.sourceKind === "availability") {
        const window = availabilityById.get(providerDraft.sourceId);
        if (window) {
          await deactivateBaseAvailabilityWindow(window);
        }
      } else {
        const block = personalBlocksById.get(providerDraft.sourceId);
        if (block) {
          await deactivatePersonalBlock(activeProvider, block);
        }
      }

      setClientStatus(`${providerDraft.sourceKind === "availability" ? "Availability" : "Personal block"} deleted.`);
      setProviderDraft(null);
    } catch (error) {
      setClientStatus("Could not delete that range.");
    }
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

        <div className="stack-sm">
          <div className="chip-row">
            <button
              className={`chip ${providerEditMode === "availability" ? "chip--active" : ""}`}
              onClick={() => setProviderEditMode("availability")}
              type="button"
            >
              Availability
            </button>
            <button
              className={`chip ${providerEditMode === "personal-block" ? "chip--active" : ""}`}
              onClick={() => setProviderEditMode("personal-block")}
              type="button"
            >
              Personal blocks
            </button>
          </div>
          <p>
            Click empty space to create a {providerEditMode === "availability" ? "weekly availability window" : "personal block"}.
            Use the draft controls to save changes, discard a new range, or delete an existing one.
          </p>
          {clientStatus ? <div className="status-banner">{clientStatus}</div> : null}
        </div>

        <WeekView
          role="provider"
          blocks={blocks}
          horizonDays={horizonDays}
          onExtendHorizon={setHorizonDays}
          providerEdit={{
            mode: providerEditMode,
            draft: providerDraft,
            onCreateDraft: (dayStart, startMinutes) => {
              const duration = providerEditMode === "availability" ? DEFAULT_AVAILABILITY_DURATION : DEFAULT_BLOCK_DURATION;
              const clampedStart = clamp(startMinutes, DAY_START_MINUTES, DAY_END_MINUTES - duration);
              setProviderDraft({
                id: createDraftId(providerEditMode, toDayKey(dayStart)),
                sourceKind: providerEditMode,
                dayKey: toDayKey(dayStart),
                dayStart,
                weekday: weekdayFromTimestamp(dayStart),
                startMinutes: clampedStart,
                endMinutes: clampedStart + duration,
                isNew: true,
              });
            },
            onEditBlock: (block) => {
              const nextDraft = createDraftFromBlock(block);
              if (nextDraft) {
                setProviderDraft(nextDraft);
              }
            },
            onChangeDraft: setProviderDraft,
            onSaveDraft: () => {
              if (providerDraft) {
                void persistProviderDraft(providerDraft, {
                  clearDraftAfterSave: true,
                  announceSuccess: true,
                });
              }
            },
            onDeleteDraft: () => {
              void deleteProviderDraft();
            },
          }}
        />
      </section>

      <aside className="stack">
        <section className="panel">
          <p className="eyebrow">New client</p>
          <h2>Create client</h2>
          <div className="stack-sm">
            <label className="field">
              <span>Name</span>
              <input value={clientName} onChange={(event) => setClientName(event.target.value)} />
            </label>
            <button
              className="button"
              onClick={async () => {
                if (!clientName.trim()) {
                  setClientStatus("Add a client name first.");
                  return;
                }

                try {
                  const result = await createClient(provider, { fullName: clientName.trim() });
                  setClientName("");
                  setClientStatus(null);
                  navigate(`/provider/clients/${result.client.id}/settings`);
                } catch (error) {
                  setClientStatus("Could not create that client.");
                }
              }}
              type="button"
            >
              Create client
            </button>
          </div>
        </section>

        <section className="panel">
          <p className="eyebrow">Clients</p>
          <h2>Active roster</h2>
          <div className="stack-sm">
            {(clients.rows ?? []).map((client) => (
              <div className="summary-card" key={client.id}>
                <strong>{client.fields.fullName}</strong>
                <p>
                  Minimum {client.fields.minimumDurationMinutes / 60}h · Travel {client.fields.travelTimeMinutes} min
                </p>
                <div className="row-actions">
                  <a className="button button--ghost" href={`/provider/clients/${client.id}/settings`}>
                    Client settings
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}
