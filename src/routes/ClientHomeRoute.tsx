import { useMemo, useState } from "react";
import { useSearchParams, useParams } from "react-router-dom";
import type { RowRef } from "@vennbase/core";
import type { UseSessionResult } from "@vennbase/react";
import { useParents, useQuery, useRow } from "@vennbase/react";
import { cancelSession, createSessionBooking } from "../domain/actions";
import {
  buildClientWeekBlocks,
  createBookingDraftFromBlock,
  createBookingDraftFromPreviousSession,
  dedupePresetShapes,
  findNextMatchingSlot,
  toSlotShapeFromSession,
} from "../domain/availability";
import { formatDayLabel, formatDuration, formatTime, minutesFromTimestamp, toDayKey } from "../domain/date";
import { RangeEditor } from "../components/RangeEditor";
import { WeekView } from "../components/WeekView";
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
  const [horizonDays, setHorizonDays] = useState(14);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReturnType<typeof createBookingDraftFromBlock> | null>(null);

  const clientRef = clientId ? makeRowRef("clients", clientId) : null;
  const client = useRow<Schema, "clients">(db, clientRef);
  const clientParents = useParents(db, client.data);
  const providerRef: RowRef<"providers"> | undefined = providerIdFromUrl
    ? makeRowRef("providers", providerIdFromUrl)
    : clientParents.data?.find((row): row is RowRef<"providers"> => row.collection === "providers");
  const provider = useRow<Schema, "providers">(db, providerRef);

  const allowedWindows = useQuery(
    db,
    "clientAllowedWindows",
    client.data ? { in: client.data.ref, index: "byWeekday", order: "asc" } : null,
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

  const blocks = useMemo(() => {
    if (!client.data) {
      return [];
    }

    return buildClientWeekBlocks({
      allowedWindows: allowedWindows.rows,
      sessions: sessions.rows,
      publicBusyWindows: publicBusyWindows.rows,
      client: client.data,
      horizonDays,
    });
  }, [allowedWindows.rows, client.data, horizonDays, publicBusyWindows.rows, sessions.rows]);

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
  const quickShapes = dedupePresetShapes(presets.rows).slice(0, 3);
  const selectedSession = selectedSessionId
    ? sessions.rows.find((row) => row.id === selectedSessionId) ?? null
    : null;
  const selectedBlock = selectedBlockId ? blocks.find((block) => block.id === selectedBlockId) ?? null : null;

  const signInGate = !session.session?.signedIn ? (
    <div className="panel">
      <h1>Client booking home</h1>
      <p>Sign in with Puter to open your invite and view your week.</p>
      <button className="button" onClick={() => void session.signIn()} type="button">
        Sign in
      </button>
    </div>
  ) : null;

  if (signInGate) {
    return signInGate;
  }

  async function bookFromDraft(nextDraft: NonNullable<typeof draft>) {
    if (!provider.data || !client.data) {
      return;
    }

    await createSessionBooking({
      provider: provider.data,
      client: client.data,
      draft: nextDraft,
      bookedByRole: "client",
    });

    setDraft(null);
    setSelectedBlockId(null);
    setFeedback("Booked. Your session now shows an arrival window and duration instead of a fixed end time.");
  }

  async function bookSameSlotNow() {
    if (!latestSession || !client.data) {
      return;
    }

    const slot = findNextMatchingSlot(blocks, toSlotShapeFromSession(latestSession));
    if (!slot) {
      setFeedback("That exact slot is no longer free. Pick a nearby time below.");
      setSelectedBlockId(null);
      setDraft(null);
      return;
    }

    const nextDraft = createBookingDraftFromBlock(slot, client.data.fields.minimumDurationMinutes);
    await bookFromDraft(nextDraft);
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
            <strong>Book {latestSession.fields.slotLabel} again?</strong>
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
          horizonDays={horizonDays}
          onExtendHorizon={setHorizonDays}
          onSelectBlock={(block) => {
            if (!client.data) {
              return;
            }

            const previousShape = latestSession ? toSlotShapeFromSession(latestSession) : quickShapes[0];
            setSelectedBlockId(block.id);
            setDraft(createBookingDraftFromBlock(block, client.data.fields.minimumDurationMinutes, previousShape));
          }}
          onSelectSession={(block) => {
            setSelectedSessionId(block.sessionRef?.id ?? null);
            setSelectedBlockId(null);
            setDraft(null);
          }}
        />
      </section>

      <aside className="panel">
        {selectedBlock && draft && client.data ? (
          <>
            <p className="eyebrow">Booking draft</p>
            <h2>{selectedBlock.state === "maybe" ? "Flexible arrival slot" : "Confirm booking"}</h2>
            <p>
              {selectedBlock.state === "maybe"
                ? `From ${formatTime(selectedBlock.startsAt)} if traffic is light. Guaranteed from ${formatTime(selectedBlock.guaranteedStartAt ?? selectedBlock.startsAt)}.`
                : "Adjust your visit within the available window."}
            </p>
            <RangeEditor
              minMinutes={minutesFromTimestamp(selectedBlock.guaranteedStartAt ?? selectedBlock.startsAt)}
              maxMinutes={minutesFromTimestamp(selectedBlock.endsAt)}
              step={30}
              minDurationMinutes={client.data.fields.minimumDurationMinutes}
              startMinutes={minutesFromTimestamp(draft.guaranteedStartAt)}
              endMinutes={minutesFromTimestamp(draft.endsAt)}
              earliestStartMinutes={
                draft.earliestStartAt === undefined ? undefined : minutesFromTimestamp(draft.earliestStartAt)
              }
              allowEarlyStart={selectedBlock.state === "maybe"}
              onChange={(next) => {
                const dayStart = new Date(`${selectedBlock.dayKey}T00:00:00`).getTime();
                setDraft({
                  ...draft,
                  guaranteedStartAt: dayStart + next.startMinutes * 60 * 1000,
                  earliestStartAt:
                    next.earliestStartMinutes === undefined
                      ? undefined
                      : dayStart + next.earliestStartMinutes * 60 * 1000,
                  startsAt:
                    next.earliestStartMinutes === undefined
                      ? dayStart + next.startMinutes * 60 * 1000
                      : dayStart + next.earliestStartMinutes * 60 * 1000,
                  endsAt: dayStart + next.endMinutes * 60 * 1000,
                  durationMinutes: next.endMinutes - next.startMinutes,
                  dayKey: toDayKey(dayStart),
                });
              }}
            />
            <button className="button" onClick={() => void bookFromDraft(draft)} type="button">
              Confirm booking
            </button>
          </>
        ) : null}

        {selectedSession ? (
          <>
            <p className="eyebrow">Session detail</p>
            <h2>{selectedSession.fields.slotLabel}</h2>
            <p>
              Arrival:{" "}
              {selectedSession.fields.earliestStartAt
                ? `${formatTime(selectedSession.fields.earliestStartAt)} to ${formatTime(selectedSession.fields.guaranteedStartAt)}`
                : formatTime(selectedSession.fields.guaranteedStartAt)}
            </p>
            <p>Duration: {formatDuration(selectedSession.fields.durationMinutes)}</p>
            <div className="row-actions">
              <button
                className="button"
                onClick={() => {
                  setDraft(createBookingDraftFromPreviousSession(selectedSession));
                  setSelectedSessionId(null);
                }}
                type="button"
              >
                Rebook same slot
              </button>
              {provider.data ? (
                <button
                  className="button button--ghost"
                  onClick={() => {
                    const providerRow = provider.data;
                    if (!providerRow) {
                      return;
                    }
                    void cancelSession(providerRow, selectedSession);
                  }}
                  type="button"
                >
                  Cancel session
                </button>
              ) : null}
            </div>
          </>
        ) : null}

        {!selectedSession && !draft ? (
          <>
            <p className="eyebrow">How this works</p>
            <h2>Hours start on arrival</h2>
            <p>Maybe slots show an earliest possible arrival and a guaranteed start. We do not promise a fixed end time.</p>
          </>
        ) : null}
      </aside>
    </div>
  );
}
