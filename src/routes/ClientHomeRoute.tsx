import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useParams } from "react-router-dom";
import type { RowRef } from "@vennbase/core";
import type { UseSessionResult } from "@vennbase/react";
import { useQuery, useRow } from "@vennbase/react";
import { cancelSession, createSessionBooking, updateSessionBooking } from "../domain/actions";
import {
  buildClientWeekBlocks,
  createBookingDraftFromBlock,
  dedupePresetShapes,
  findMatchingSlotAtTime,
  findNextMatchingSlot,
  findSlotContainingTime,
  toSlotShapeFromSession,
} from "../domain/availability";
import { addDays, formatDayLabel, formatDuration, formatTime, minutesFromTimestamp } from "../domain/date";
import { WeekView } from "../components/WeekView";
import { findSavedClientAccess, saveClientAccess } from "../lib/clientAccess";
import { db } from "../lib/db";
import { makeRowRef } from "../lib/rowRef";
import type { Schema } from "../lib/schema";

interface ClientHomeRouteProps {
  session: UseSessionResult;
}

export function ClientHomeRoute({ session }: ClientHomeRouteProps) {
  const { clientId } = useParams();
  const [searchParams] = useSearchParams();
  const providerIdFromUrl = searchParams.get("providerId");
  const providerBaseUrlFromUrl = searchParams.get("providerBaseUrl");
  const [horizonDays, setHorizonDays] = useState(14);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReturnType<typeof createBookingDraftFromBlock> | null>(null);
  const [savedAccess, setSavedAccess] = useState<Awaited<ReturnType<typeof findSavedClientAccess>> | undefined>(undefined);
  const needsSavedAccess = Boolean(clientId && (!providerIdFromUrl || !providerBaseUrlFromUrl));

  useEffect(() => {
    if (!needsSavedAccess || !clientId) {
      setSavedAccess(null);
      return;
    }

    let isCancelled = false;

    void findSavedClientAccess(clientId).then((nextSavedAccess) => {
      if (!isCancelled) {
        setSavedAccess(nextSavedAccess);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [clientId, needsSavedAccess]);

  const resolvedProviderId = providerIdFromUrl ?? savedAccess?.providerId;
  const resolvedProviderBaseUrl = providerBaseUrlFromUrl ?? savedAccess?.providerBaseUrl;
  const providerRef: RowRef<"providers"> | undefined =
    resolvedProviderId && resolvedProviderBaseUrl
      ? makeRowRef("providers", resolvedProviderId, resolvedProviderBaseUrl)
      : undefined;
  const provider = useRow<Schema, "providers">(db, providerRef);
  const providerClients = useQuery(
    db,
    "clients",
    provider.data ? { in: provider.data.ref, index: "byName", order: "asc" } : null,
  );
  const client = {
    data: clientId ? providerClients.rows.find((row) => row.id === clientId) ?? null : null,
  };

  const baseAvailability = useQuery(
    db,
    "baseAvailabilityWindows",
    provider.data ? { in: provider.data.ref, index: "byWeekday", order: "asc" } : null,
  );
  const sessions = useQuery(db, "sessions", client.data ? { in: client.data.ref, index: "byStart", order: "asc" } : null);
  const presets = useQuery(
    db,
    "rebookingPresets",
    client.data ? { in: client.data.ref, index: "byLastUsedAt", order: "desc", limit: 8 } : null,
  );
  const publicBusyWindows = useQuery(
    db,
    "publicBusyWindows",
    provider.data ? { in: provider.data.ref, index: "byStart", order: "asc" } : null,
  );

  function buildBlocks(excludeSessionId?: string) {
    if (!client.data) {
      return [];
    }

    return buildClientWeekBlocks({
      baseAvailability: baseAvailability.rows,
      sessions: sessions.rows,
      publicBusyWindows: publicBusyWindows.rows,
      client: client.data,
      horizonDays,
      excludeSessionId,
    });
  }

  const blocks = useMemo(
    () => buildBlocks(editingSessionId ?? undefined),
    [baseAvailability.rows, client.data, editingSessionId, horizonDays, publicBusyWindows.rows, sessions.rows],
  );

  const activeSessions = useMemo(
    () =>
      sessions.rows
        .filter((row) => row.fields.status !== "canceled")
        .sort((left, right) => left.fields.guaranteedStartAt - right.fields.guaranteedStartAt),
    [sessions.rows],
  );
  const nextSession = activeSessions.find((row) => row.fields.guaranteedStartAt >= Date.now()) ?? null;
  const latestSession = [...activeSessions].sort(
    (left, right) => right.fields.guaranteedStartAt - left.fields.guaranteedStartAt,
  )[0];
  const suggestedRebookAt = latestSession ? addDays(latestSession.fields.guaranteedStartAt, 7) : null;
  const suggestedRebookPrompt = suggestedRebookAt
    ? `Book ${new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(suggestedRebookAt)} ${formatTime(
        suggestedRebookAt,
      )} again on ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(suggestedRebookAt)}?`
    : null;
  const quickShapes = dedupePresetShapes(presets.rows).slice(0, 3);
  const selectedSession = selectedSessionId
    ? sessions.rows.find((row) => row.id === selectedSessionId) ?? null
    : null;
  const editingSession = editingSessionId
    ? sessions.rows.find((row) => row.id === editingSessionId) ?? null
    : null;
  const selectedBlock = selectedBlockId ? blocks.find((block) => block.id === selectedBlockId) ?? null : null;
  const bookingBounds = useMemo(() => {
    if (!selectedBlock) {
      return null;
    }

    const dayStart = new Date(`${selectedBlock.dayKey}T00:00:00`).getTime();
    return {
      dayKey: selectedBlock.dayKey,
      dayStart,
      minStartMinutes: minutesFromTimestamp(selectedBlock.guaranteedStartAt ?? selectedBlock.startsAt),
      maxEndMinutes: minutesFromTimestamp(selectedBlock.endsAt),
      minDurationMinutes: client.data?.fields.minimumDurationMinutes ?? 30,
    };
  }, [client.data?.fields.minimumDurationMinutes, selectedBlock]);

  const signInGate = !session.session?.signedIn ? (
    <div className="panel">
      <h1>Client booking home</h1>
      <p>Sign in with Puter to open your invite and view your week.</p>
      <button className="button" onClick={() => void session.signIn()} type="button">
        Sign in
      </button>
    </div>
  ) : null;

  useEffect(() => {
    if (!provider.data || !client.data) {
      return;
    }

    void saveClientAccess({
      clientId: client.data.id,
      clientName: client.data.fields.fullName,
      providerId: provider.data.id,
      providerName: provider.data.fields.displayName,
      providerBaseUrl: provider.data.ref.baseUrl,
    });
  }, [
    client.data?.fields.fullName,
    client.data?.id,
    provider.data?.fields.displayName,
    provider.data?.id,
    provider.data?.ref.baseUrl,
  ]);

  if (signInGate) {
    return signInGate;
  }

  if (needsSavedAccess && savedAccess === undefined) {
    return (
      <div className="panel">
        <h1>Opening client home…</h1>
      </div>
    );
  }

  if (!providerRef) {
    return (
      <div className="panel">
        <h1>Client booking home</h1>
        <p>We could not recover the provider workspace for this client. Open the original invite link again.</p>
      </div>
    );
  }

  function resetBookingSelection() {
    setDraft(null);
    setSelectedBlockId(null);
    setSelectedSessionId(null);
    setEditingSessionId(null);
  }

  async function confirmDraft(nextDraft: NonNullable<typeof draft>, sessionToEdit: typeof editingSession = editingSession) {
    if (!provider.data || !client.data) {
      return;
    }

    try {
      if (sessionToEdit) {
        await updateSessionBooking({
          provider: provider.data,
          client: client.data,
          session: sessionToEdit,
          draft: nextDraft,
          bookedByRole: "client",
        });
        resetBookingSelection();
        setFeedback("Updated. Your session now reflects the new slot.");
        return;
      }

      await createSessionBooking({
        provider: provider.data,
        client: client.data,
        draft: nextDraft,
        bookedByRole: "client",
      });

      resetBookingSelection();
      setFeedback("Booked. Your session now shows an arrival window and duration instead of a fixed end time.");
    } catch (error) {
      setFeedback(sessionToEdit ? "Could not update that session." : "Could not book that session.");
    }
  }

  async function bookSameSlotNow() {
    if (!latestSession || !client.data || !suggestedRebookAt) {
      return;
    }

    const slot = findMatchingSlotAtTime(blocks, suggestedRebookAt, latestSession.fields.durationMinutes);
    if (!slot) {
      setFeedback("That time next week is no longer free. Pick a nearby time below.");
      setSelectedBlockId(null);
      setDraft(null);
      return;
    }

    const nextDraft = createBookingDraftFromBlock(slot, client.data.fields.minimumDurationMinutes);
    await confirmDraft(nextDraft, null);
  }

  function draftSuggestedRebooking(sessionRow: NonNullable<typeof selectedSession | typeof latestSession>) {
    if (!client.data) {
      return;
    }

    const nextWeekStartAt = addDays(sessionRow.fields.guaranteedStartAt, 7);
    const slot = findMatchingSlotAtTime(blocks, nextWeekStartAt, sessionRow.fields.durationMinutes);
    if (!slot) {
      setFeedback("That time next week is no longer free. Pick a nearby time below.");
      setSelectedBlockId(null);
      setDraft(null);
      return;
    }

    setFeedback(null);
    setEditingSessionId(null);
    setSelectedBlockId(slot.id);
    setSelectedSessionId(null);
    setDraft(createBookingDraftFromBlock(slot, client.data.fields.minimumDurationMinutes, toSlotShapeFromSession(sessionRow)));
  }

  function startEditingSession(sessionRow: NonNullable<typeof selectedSession>) {
    if (!client.data) {
      return;
    }

    const editableBlocks = buildBlocks(sessionRow.id);
    const matchingBlock = findSlotContainingTime(
      editableBlocks,
      sessionRow.fields.guaranteedStartAt,
      sessionRow.fields.durationMinutes,
    );

    setEditingSessionId(sessionRow.id);
    setSelectedSessionId(sessionRow.id);
    setFeedback(null);

    if (!matchingBlock) {
      setDraft(null);
      setSelectedBlockId(null);
      setFeedback("That session's current time is no longer open. Pick another available slot below.");
      return;
    }

    setSelectedBlockId(matchingBlock.id);
    setDraft(
      createBookingDraftFromBlock(
        matchingBlock,
        client.data.fields.minimumDurationMinutes,
        toSlotShapeFromSession(sessionRow),
      ),
    );
  }

  async function cancelSelectedSession(sessionRow: NonNullable<typeof selectedSession>) {
    if (!provider.data) {
      return;
    }

    try {
      await cancelSession(provider.data, sessionRow);
      resetBookingSelection();
      setFeedback("Session canceled.");
    } catch (error) {
      setFeedback("Could not cancel that session.");
    }
  }

  function stopEditingSession() {
    setDraft(null);
    setSelectedBlockId(null);
    setSelectedSessionId(null);
    setEditingSessionId(null);
    setFeedback(null);
  }

  return (
    <div className="page-grid">
      <section className="panel panel--wide">
        <p className="eyebrow">Client home</p>
        <h1>{client.data?.fields.fullName ?? "Your booking home"}</h1>
        <p>
          {provider.data?.fields.displayName ?? "Your provider"} keeps this view current with your relationship-specific
          rules.
        </p>

        {nextSession ? (
          <div className="summary-card">
            <span className="eyebrow">Next confirmed session</span>
            <strong>{nextSession.fields.slotLabel}</strong>
            <p>
              Arrival window:{" "}
              {nextSession.fields.earliestStartAt
                ? `${formatTime(nextSession.fields.earliestStartAt)} to ${formatTime(nextSession.fields.guaranteedStartAt)}`
                : formatTime(nextSession.fields.guaranteedStartAt)}
            </p>
            <p>Duration: {formatDuration(nextSession.fields.durationMinutes)}</p>
          </div>
        ) : null}

        {latestSession ? (
          <div className="summary-card summary-card--accent">
            <span className="eyebrow">Book again</span>
            <strong>{suggestedRebookPrompt}</strong>
            <div className="row-actions">
              <button className="button" onClick={() => void bookSameSlotNow()} type="button">
                Book it
              </button>
              <button className="button button--ghost" onClick={() => setFeedback("Choose a different block below.")} type="button">
                Pick a different time
              </button>
            </div>
          </div>
        ) : null}

        {quickShapes.length > 0 ? (
          <div className="chip-row">
            {quickShapes.map((shape) => (
              <button
                key={`${shape.weekday}-${shape.startMinutes}-${shape.durationMinutes}`}
                className="chip"
                onClick={() => {
                  const match = findNextMatchingSlot(blocks, shape);
                  if (!match || !client.data) {
                    setFeedback("That usual slot is not open right now.");
                    return;
                  }

                  setFeedback(null);
                  setSelectedBlockId(match.id);
                  setDraft(createBookingDraftFromBlock(match, client.data.fields.minimumDurationMinutes, shape));
                }}
                type="button"
              >
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][shape.weekday]} · {shape.durationMinutes / 60}h
              </button>
            ))}
          </div>
        ) : null}

        {feedback ? <div className="status-banner">{feedback}</div> : null}

        <WeekView
          role="client"
          blocks={blocks}
          selectedDraft={draft}
          bookingEdit={
            draft
              ? {
                  draft,
                  bounds: bookingBounds,
                  onChangeDraft: setDraft,
                  onConfirmDraft: () => {
                    void confirmDraft(draft);
                  },
                  confirmLabel: editingSession ? "Update" : "Confirm",
                }
              : undefined
          }
          horizonDays={horizonDays}
          onExtendHorizon={setHorizonDays}
          onSelectBlock={(block) => {
            if (!client.data) {
              return;
            }

            const previousShape = editingSession
              ? toSlotShapeFromSession(editingSession)
              : latestSession
                ? toSlotShapeFromSession(latestSession)
                : quickShapes[0];
            setFeedback(null);
            setSelectedBlockId(block.id);
            setSelectedSessionId(null);
            setDraft(createBookingDraftFromBlock(block, client.data.fields.minimumDurationMinutes, previousShape));
          }}
          onSelectSession={(block) => {
            const sessionRow = block.sessionRef?.id ? sessions.rows.find((row) => row.id === block.sessionRef?.id) ?? null : null;
            if (!sessionRow) {
              return;
            }

            startEditingSession(sessionRow);
          }}
        />
      </section>

      <aside className="panel">
        {draft ? (
          <>
            <p className="eyebrow">{editingSession ? "Edit session" : "Booking draft"}</p>
            <h2>
              {selectedBlock?.state === "maybe"
                ? "Flexible arrival slot"
                : editingSession
                  ? "Update booking"
                  : "Confirm booking"}
            </h2>
            <p>
              {selectedBlock
                ? selectedBlock.state === "maybe"
                  ? `Drag the booking directly on the planner. Arrival can start from ${formatTime(selectedBlock.startsAt)} if traffic is light, with a guaranteed start from ${formatTime(selectedBlock.guaranteedStartAt ?? selectedBlock.startsAt)}.`
                  : editingSession
                    ? "Drag the booking directly on the planner to keep this session within an open slot."
                    : "Drag the booking directly on the planner to adjust start time and length within this open window."
                : editingSession
                  ? "Pick an open slot below to move this session, then drag it on the planner if you want to fine-tune the time."
                  : "Use the draft on the planner to confirm this booking. Pick an open slot first if you want to drag it."}
            </p>
            <div className="summary-card">
              <span className="eyebrow">Selected time</span>
              <strong>{formatDayLabel(draft.guaranteedStartAt)}</strong>
              <p>
                {formatTime(draft.earliestStartAt ?? draft.guaranteedStartAt)}
                {" - "}
                {formatTime(draft.endsAt)}
              </p>
              <p>Duration: {formatDuration(draft.durationMinutes)}</p>
            </div>
            <div className="row-actions">
              <button className="button button--ghost" onClick={() => stopEditingSession()} type="button">
                Keep current booking
              </button>
              {editingSession ? (
                <button
                  className="button button--ghost"
                  onClick={() => {
                    void cancelSelectedSession(editingSession);
                  }}
                  type="button"
                >
                  Cancel session
                </button>
              ) : null}
            </div>
          </>
        ) : null}

        {editingSession && !draft ? (
          <>
            <p className="eyebrow">Edit session</p>
            <h2>Choose a replacement slot</h2>
            <p>Open blocks below already reflect the same booking limits this client can use when creating a session.</p>
            <div className="summary-card">
              <span className="eyebrow">Current session</span>
              <strong>{editingSession.fields.slotLabel}</strong>
              <p>
                {formatTime(editingSession.fields.earliestStartAt ?? editingSession.fields.guaranteedStartAt)}
                {" - "}
                {formatTime(
                  editingSession.fields.guaranteedStartAt + editingSession.fields.durationMinutes * 60 * 1000,
                )}
              </p>
              <p>Duration: {formatDuration(editingSession.fields.durationMinutes)}</p>
            </div>
            <div className="row-actions">
              <button className="button button--ghost" onClick={() => stopEditingSession()} type="button">
                Keep current booking
              </button>
              <button
                className="button button--ghost"
                onClick={() => {
                  void cancelSelectedSession(editingSession);
                }}
                type="button"
              >
                Cancel session
              </button>
            </div>
          </>
        ) : null}

        {!editingSession && !draft ? (
          <>
            <p className="eyebrow">How this works</p>
            <h2>Book within open provider hours</h2>
            <p>Open slots already include the travel buffer configured for your account. Choose a start time and visit length.</p>
          </>
        ) : null}
      </aside>
    </div>
  );
}
