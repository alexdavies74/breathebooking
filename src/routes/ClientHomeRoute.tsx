import { CURRENT_USER, type RowRef } from "@vennbase/core";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import type { UseSessionResult } from "@vennbase/react";
import { useQuery, useRow } from "@vennbase/react";
import { cancelBooking, createBooking, updateBooking } from "../domain/actions";
import {
  buildClientWeekBlocks,
  createBookingDraftFromBlock,
  dedupePresetShapes,
  findMatchingSlotAtTime,
  findNextMatchingSlot,
  findSlotContainingTime,
  toSlotShapeFromSavedBooking,
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
  const [horizonDays, setHorizonDays] = useState(14);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [editingBookingId, setEditingBookingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReturnType<typeof createBookingDraftFromBlock> | null>(null);
  const [savedAccess, setSavedAccess] = useState<Awaited<ReturnType<typeof findSavedClientAccess>> | undefined>(undefined);
  const [providerRef, setProviderRef] = useState<RowRef<"providers"> | null>(null);
  const [providerAccessError, setProviderAccessError] = useState<string | null>(null);
  const [bookingRootRef, setBookingRootRef] = useState<RowRef<"bookingRoots"> | null>(null);
  const [bookingRootError, setBookingRootError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) {
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
  }, [clientId]);

  const clientRef =
    clientId && savedAccess?.clientBaseUrl
      ? makeRowRef("clients", clientId, savedAccess.clientBaseUrl)
      : undefined;
  const client = useRow<Schema, "clients">(db, clientRef);
  const provider = useRow<Schema, "providers">(db, providerRef ?? undefined);

  useEffect(() => {
    let isCancelled = false;

    const currentClient = client.data;

    if (!currentClient) {
      setProviderRef(null);
      setProviderAccessError(null);
      return () => {
        isCancelled = true;
      };
    }

    setProviderAccessError(null);
    void db
      .acceptInvite(currentClient.fields.providerViewerLink)
      .then(async (providerRow) => {
        if (isCancelled) {
          return;
        }

        if (providerRow.collection !== "providers") {
          throw new Error(`Expected providers row, got ${providerRow.collection}`);
        }

        setProviderRef(providerRow.ref as RowRef<"providers">);
        await saveClientAccess({
          clientId: currentClient.id,
          clientBaseUrl: currentClient.ref.baseUrl,
          clientName: currentClient.fields.fullName,
          providerName: providerRow.fields.displayName,
        });
      })
      .catch(() => {
        if (!isCancelled) {
          setProviderAccessError("We could not open the shared provider workspace for this client.");
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [client.data]);

  useEffect(() => {
    let isCancelled = false;

    if (!provider.data?.fields.bookingSubmitterLink) {
      setBookingRootRef(null);
      setBookingRootError(provider.data ? "This provider workspace is missing a booking inbox." : null);
      return () => {
        isCancelled = true;
      };
    }

    setBookingRootError(null);
    void db
      .joinInvite(provider.data.fields.bookingSubmitterLink)
      .then((joined) => {
        if (isCancelled) {
          return;
        }

        if (joined.ref.collection !== "bookingRoots") {
          throw new Error(`Expected bookingRoots ref, got ${joined.ref.collection}`);
        }

        setBookingRootRef(joined.ref as RowRef<"bookingRoots">);
      })
      .catch(() => {
        if (!isCancelled) {
          setBookingRootError("We could not open the private booking inbox for this client.");
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [provider.data?.fields.bookingSubmitterLink]);

  const baseAvailability = useQuery(
    db,
    "baseAvailabilityWindows",
    provider.data ? { in: provider.data.ref, orderBy: "sortKey", order: "asc" } : null,
  );
  const sharedBookings = useQuery(
    db,
    "bookings",
    bookingRootRef ? { in: bookingRootRef, select: "keys", orderBy: "startsAt", order: "asc" } : null,
  );
  const bookingBlocks = useQuery(
    db,
    "bookingBlocks",
    bookingRootRef ? { in: bookingRootRef, select: "keys", orderBy: "startsAt", order: "asc" } : null,
  );
  const savedBookings = useQuery(
    db,
    "savedBookings",
    client.data ? { in: CURRENT_USER, where: { clientRef: client.data.ref }, orderBy: "startsAt", order: "asc" } : null,
  );
  const presets = useQuery(
    db,
    "rebookingPresets",
    client.data ? { in: CURRENT_USER, where: { clientRef: client.data.ref }, orderBy: "lastUsedAt", order: "desc", limit: 8 } : null,
  );

  function buildBlocks(excludeBookingId?: string) {
    if (!client.data) {
      return [];
    }

    return buildClientWeekBlocks({
      baseAvailability: baseAvailability.rows ?? [],
      bookings: sharedBookings.rows ?? [],
      bookingBlocks: bookingBlocks.rows ?? [],
      savedBookings: savedBookings.rows ?? [],
      client: client.data,
      horizonDays,
      excludeBookingId,
    });
  }

  const blocks = useMemo(
    () => buildBlocks(editingBookingId ?? undefined),
    [
      baseAvailability.rows,
      bookingBlocks.rows,
      client.data,
      editingBookingId,
      horizonDays,
      savedBookings.rows,
      sharedBookings.rows,
    ],
  );

  const activeBookings = useMemo(
    () =>
      (savedBookings.rows ?? [])
        .filter((row) => row.fields.status !== "canceled")
        .sort((left, right) => left.fields.guaranteedStartAt - right.fields.guaranteedStartAt),
    [savedBookings.rows],
  );
  const nextBooking = activeBookings.find((row) => row.fields.guaranteedStartAt >= Date.now()) ?? null;
  const latestBooking = [...activeBookings].sort(
    (left, right) => right.fields.guaranteedStartAt - left.fields.guaranteedStartAt,
  )[0] ?? null;
  const suggestedRebookAt = latestBooking ? addDays(latestBooking.fields.guaranteedStartAt, 7) : null;
  const suggestedRebookPrompt = suggestedRebookAt
    ? `Book ${new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(suggestedRebookAt)} ${formatTime(
        suggestedRebookAt,
      )} again on ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(suggestedRebookAt)}?`
    : null;
  const quickShapes = dedupePresetShapes(presets.rows ?? []).slice(0, 3);
  const selectedBooking = selectedBookingId
    ? activeBookings.find((row) => row.fields.bookingRef.id === selectedBookingId) ?? null
    : null;
  const editingBooking = editingBookingId
    ? activeBookings.find((row) => row.fields.bookingRef.id === editingBookingId) ?? null
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
      clientBaseUrl: client.data.ref.baseUrl,
      clientName: client.data.fields.fullName,
      providerName: provider.data.fields.displayName,
    });
  }, [
    client.data?.fields.fullName,
    client.data?.id,
    client.data?.ref.baseUrl,
    provider.data?.fields.displayName,
  ]);

  if (signInGate) {
    return signInGate;
  }

  if (savedAccess === undefined) {
    return (
      <div className="panel">
        <h1>Opening client home…</h1>
      </div>
    );
  }

  if (!clientId || !clientRef || !savedAccess) {
    return (
      <div className="panel">
        <h1>Client booking home</h1>
        <p>We could not recover the private client workspace. Open the original invite link again.</p>
      </div>
    );
  }

  if (providerAccessError) {
    return (
      <div className="panel">
        <h1>Client booking home</h1>
        <p>{providerAccessError}</p>
      </div>
    );
  }

  if (bookingRootError) {
    return (
      <div className="panel">
        <h1>Client booking home</h1>
        <p>{bookingRootError}</p>
      </div>
    );
  }

  function resetBookingSelection() {
    setDraft(null);
    setSelectedBlockId(null);
    setSelectedBookingId(null);
    setEditingBookingId(null);
  }

  async function persistDraft(
    nextDraft: NonNullable<typeof draft>,
    options: { bookingId?: string | null; resetAfterSave: boolean; announceSuccess: boolean },
  ) {
    if (!bookingRootRef || !client.data) {
      return;
    }

    const bookingToEdit = options.bookingId
      ? activeBookings.find((row) => row.fields.bookingRef.id === options.bookingId) ?? null
      : null;

    try {
      if (bookingToEdit) {
        await updateBooking({
          bookingRootRef,
          client: client.data,
          savedBooking: bookingToEdit,
          draft: nextDraft,
          bookedByRole: "client",
        });

        if (options.resetAfterSave) {
          resetBookingSelection();
        } else if (options.announceSuccess) {
          setFeedback("Saved. Your booking now reflects the new slot.");
        }
        return;
      }

      await createBooking({
        bookingRootRef,
        client: client.data,
        draft: nextDraft,
        bookedByRole: "client",
      });

      if (options.resetAfterSave) {
        resetBookingSelection();
      }
      setFeedback("Booked. Your visit now appears in your private booking list.");
    } catch (error) {
      setFeedback(bookingToEdit ? "Could not update that booking." : "Could not book that slot.");
    }
  }

  async function bookSameSlotNow() {
    if (!latestBooking || !client.data || !suggestedRebookAt) {
      return;
    }

    const slot = findMatchingSlotAtTime(blocks, suggestedRebookAt, latestBooking.fields.durationMinutes);
    if (!slot) {
      setFeedback("That time next week is no longer free. Pick a nearby time below.");
      setSelectedBlockId(null);
      setDraft(null);
      return;
    }

    const nextDraft = createBookingDraftFromBlock(slot, client.data.fields.minimumDurationMinutes);
    await persistDraft(nextDraft, { bookingId: null, resetAfterSave: true, announceSuccess: true });
  }

  function draftSuggestedRebooking(bookingRow: NonNullable<typeof selectedBooking | typeof latestBooking>) {
    if (!client.data) {
      return;
    }

    const nextWeekStartAt = addDays(bookingRow.fields.guaranteedStartAt, 7);
    const slot = findMatchingSlotAtTime(blocks, nextWeekStartAt, bookingRow.fields.durationMinutes);
    if (!slot) {
      setFeedback("That time next week is no longer free. Pick a nearby time below.");
      setSelectedBlockId(null);
      setDraft(null);
      return;
    }

    setFeedback(null);
    setEditingBookingId(null);
    setSelectedBlockId(slot.id);
    setSelectedBookingId(null);
    setDraft(createBookingDraftFromBlock(slot, client.data.fields.minimumDurationMinutes, toSlotShapeFromSavedBooking(bookingRow)));
  }

  function startEditingBooking(bookingRow: NonNullable<typeof selectedBooking>) {
    if (!client.data) {
      return;
    }

    const editableBlocks = buildBlocks(bookingRow.fields.bookingRef.id);
    const matchingBlock = findSlotContainingTime(
      editableBlocks,
      bookingRow.fields.guaranteedStartAt,
      bookingRow.fields.durationMinutes,
    );

    setEditingBookingId(bookingRow.fields.bookingRef.id);
    setSelectedBookingId(bookingRow.fields.bookingRef.id);
    setFeedback(null);

    if (!matchingBlock) {
      setDraft(null);
      setSelectedBlockId(null);
      setFeedback("That booking's current time is no longer open. Pick another available slot below.");
      return;
    }

    setSelectedBlockId(matchingBlock.id);
    setDraft(
      createBookingDraftFromBlock(
        matchingBlock,
        client.data.fields.minimumDurationMinutes,
        toSlotShapeFromSavedBooking(bookingRow),
      ),
    );
  }

  async function cancelSelectedBooking(bookingRow: NonNullable<typeof selectedBooking>) {
    if (!bookingRootRef) {
      return;
    }

    try {
      await cancelBooking({
        bookingRootRef,
        savedBooking: bookingRow,
      });
      resetBookingSelection();
      setFeedback("Booking canceled.");
    } catch (error) {
      setFeedback("Could not cancel that booking.");
    }
  }

  function stopEditingBooking() {
    setDraft(null);
    setSelectedBlockId(null);
    setSelectedBookingId(null);
    setEditingBookingId(null);
    setFeedback(null);
  }

  return (
    <div className="page-grid">
      <section className="panel panel--wide">
        <p className="eyebrow">Client home</p>
        <h1>{client.data?.fields.fullName ?? "Your booking home"}</h1>
        <p>
          {provider.data?.fields.displayName ?? savedAccess.providerName} keeps this view current with your
          relationship-specific rules.
        </p>

        {nextBooking ? (
          <div className="summary-card">
            <span className="eyebrow">Next confirmed booking</span>
            <strong>{nextBooking.fields.slotLabel}</strong>
            <p>
              Arrival window:{" "}
              {nextBooking.fields.earliestStartAt
                ? `${formatTime(nextBooking.fields.earliestStartAt)} to ${formatTime(nextBooking.fields.guaranteedStartAt)}`
                : formatTime(nextBooking.fields.guaranteedStartAt)}
            </p>
            <p>Duration: {formatDuration(nextBooking.fields.durationMinutes)}</p>
          </div>
        ) : null}

        {latestBooking ? (
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
                    void persistDraft(draft, {
                      bookingId: editingBooking?.fields.bookingRef.id ?? null,
                      resetAfterSave: true,
                      announceSuccess: true,
                    });
                  },
                  onDeleteDraft: () => {
                    if (editingBooking) {
                      void cancelSelectedBooking(editingBooking);
                      return;
                    }

                    stopEditingBooking();
                  },
                  isNewDraft: !editingBooking,
                }
              : undefined
          }
          horizonDays={horizonDays}
          onExtendHorizon={setHorizonDays}
          onSelectBlock={(block) => {
            if (!client.data) {
              return;
            }

            const previousShape = editingBooking
              ? toSlotShapeFromSavedBooking(editingBooking)
              : latestBooking
                ? toSlotShapeFromSavedBooking(latestBooking)
                : quickShapes[0];
            setFeedback(null);
            setSelectedBlockId(block.id);
            setSelectedBookingId(null);
            setDraft(createBookingDraftFromBlock(block, client.data.fields.minimumDurationMinutes, previousShape));
          }}
          onSelectSession={(block) => {
            const bookingRow = block.bookingRef?.id
              ? activeBookings.find((row) => row.fields.bookingRef.id === block.bookingRef?.id) ?? null
              : null;
            if (!bookingRow) {
              return;
            }

            startEditingBooking(bookingRow);
          }}
        />
      </section>

      <aside className="panel">
        {draft ? (
          <>
            <p className="eyebrow">{editingBooking ? "Edit booking" : "Booking draft"}</p>
            <h2>
              {selectedBlock?.state === "maybe"
                ? "Flexible arrival slot"
                : editingBooking
                  ? "Update booking"
                  : "Confirm booking"}
            </h2>
            <p>
              {selectedBlock
                ? selectedBlock.state === "maybe"
                  ? `Drag the booking directly on the planner. Arrival can start from ${formatTime(selectedBlock.startsAt)} if traffic is light, with a guaranteed start from ${formatTime(selectedBlock.guaranteedStartAt ?? selectedBlock.startsAt)}.`
                  : editingBooking
                    ? "Adjust the booking on the planner, then save it or delete it from the draft controls."
                    : "Drag the booking directly on the planner, then save it from the draft card."
                : editingBooking
                  ? "Pick an open slot below to move this booking, then drag it on the planner if you want to fine-tune the time."
                  : "Use the draft on the planner to save this booking. Pick an open slot first if you want to drag it."}
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
              <button className="button button--ghost" onClick={() => stopEditingBooking()} type="button">
                Keep current booking
              </button>
              {editingBooking ? (
                <button
                  className="button button--ghost"
                  onClick={() => {
                    void cancelSelectedBooking(editingBooking);
                  }}
                  type="button"
                >
                  Cancel booking
                </button>
              ) : null}
            </div>
          </>
        ) : null}

        {editingBooking && !draft ? (
          <>
            <p className="eyebrow">Edit booking</p>
            <h2>Choose a replacement slot</h2>
            <p>Open blocks below already reflect the same booking limits this client can use when creating a booking.</p>
            <div className="summary-card">
              <span className="eyebrow">Current booking</span>
              <strong>{editingBooking.fields.slotLabel}</strong>
              <p>
                {formatTime(editingBooking.fields.earliestStartAt ?? editingBooking.fields.guaranteedStartAt)}
                {" - "}
                {formatTime(editingBooking.fields.endsAt)}
              </p>
              <p>Duration: {formatDuration(editingBooking.fields.durationMinutes)}</p>
            </div>
            <div className="row-actions">
              <button className="button button--ghost" onClick={() => stopEditingBooking()} type="button">
                Keep current booking
              </button>
              <button
                className="button button--ghost"
                onClick={() => {
                  void cancelSelectedBooking(editingBooking);
                }}
                type="button"
              >
                Cancel booking
              </button>
            </div>
          </>
        ) : null}

        {!editingBooking && !draft ? (
          <>
            <p className="eyebrow">How this works</p>
            <h2>Book within open provider hours</h2>
            <p>Open slots already include the travel buffer configured for your account. Choose a start time and visit length.</p>
            {selectedBooking || latestBooking ? (
              <div className="row-actions">
                {selectedBooking ? (
                  <button className="button button--ghost" onClick={() => draftSuggestedRebooking(selectedBooking)} type="button">
                    Book this time next week
                  </button>
                ) : latestBooking ? (
                  <button className="button button--ghost" onClick={() => draftSuggestedRebooking(latestBooking)} type="button">
                    Rebook last visit
                  </button>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </aside>
    </div>
  );
}
