import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WeekView } from "./WeekView";
import { toDayKey } from "../domain/date";
import type { BookingDraft, ProviderRangeDraft, WeekBlock } from "../domain/types";

function setCanvasRect(container: HTMLElement) {
  const canvas = container.querySelector(".day-column__canvas") as HTMLDivElement;
  Object.defineProperty(canvas, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      top: 0,
      left: 0,
      right: 180,
      bottom: 720,
      width: 180,
      height: 720,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
  return canvas;
}

function buildEditableBlock(dayKey: string): WeekBlock {
  return {
    id: "availability-1",
    dayKey,
    startsAt: new Date(`${dayKey}T09:00:00`).getTime(),
    endsAt: new Date(`${dayKey}T13:00:00`).getTime(),
    state: "available",
    interactive: true,
    label: "Open",
    sourceKind: "availability",
    sourceId: "window-1",
    weekday: new Date(`${dayKey}T00:00:00`).getDay(),
  };
}

function buildDraft(dayKey: string, isNew = false): ProviderRangeDraft {
  const dayStart = new Date(`${dayKey}T00:00:00`).getTime();
  return {
    id: "draft-1",
    sourceKind: "availability",
    sourceId: "window-1",
    dayKey,
    dayStart,
    weekday: new Date(dayStart).getDay(),
    startMinutes: 9 * 60,
    endMinutes: 13 * 60,
    isNew,
  };
}

function buildBookingDraft(dayKey: string): BookingDraft {
  return {
    startsAt: new Date(`${dayKey}T09:00:00`).getTime(),
    guaranteedStartAt: new Date(`${dayKey}T09:00:00`).getTime(),
    endsAt: new Date(`${dayKey}T12:00:00`).getTime(),
    durationMinutes: 180,
    dayKey,
    sourceBlockId: "available-1",
  };
}

describe("WeekView", () => {
  it("renders available and booked states and dispatches clicks", async () => {
    const user = userEvent.setup();
    const onSelectBlock = vi.fn();
    const onSelectSession = vi.fn();
    const dayKey = toDayKey(Date.now());

    render(
      <WeekView
        role="client"
        blocks={[
          {
            id: "available-1",
            dayKey,
            startsAt: new Date(`${dayKey}T09:00:00`).getTime(),
            endsAt: new Date(`${dayKey}T13:00:00`).getTime(),
            state: "available",
            interactive: true,
            label: "Open",
          },
          {
            id: "booked-1",
            dayKey,
            startsAt: new Date(`${dayKey}T14:00:00`).getTime(),
            endsAt: new Date(`${dayKey}T17:00:00`).getTime(),
            state: "booked-own",
            interactive: true,
            label: "My session",
            bookingRef: { id: "booking-1", collection: "bookings", baseUrl: "http://localhost" },
          },
        ]}
        onSelectBlock={onSelectBlock}
        onSelectSession={onSelectSession}
        horizonDays={1}
      />,
    );

    await user.click(screen.getByText("Open"));
    await user.click(screen.getByText("My session"));

    expect(onSelectBlock).toHaveBeenCalled();
    expect(onSelectSession).toHaveBeenCalled();
  });

  it("requests more days when scrolled near the end", () => {
    const dayKey = toDayKey(Date.now());
    const onExtendHorizon = vi.fn();

    const { container } = render(
      <WeekView
        role="provider"
        blocks={[buildEditableBlock(dayKey)]}
        horizonDays={7}
        onExtendHorizon={onExtendHorizon}
      />,
    );

    const weekView = container.querySelector(".week-view") as HTMLDivElement;
    Object.defineProperty(weekView, "scrollWidth", { configurable: true, value: 2000 });
    Object.defineProperty(weekView, "clientWidth", { configurable: true, value: 1000 });
    Object.defineProperty(weekView, "scrollLeft", { configurable: true, value: 760 });

    weekView.dispatchEvent(new Event("scroll", { bubbles: true }));

    expect(onExtendHorizon).toHaveBeenCalledWith(14);
  });

  it("creates a provider draft from empty space and shows save controls for both new and existing drafts", async () => {
    const user = userEvent.setup();
    const dayKey = toDayKey(Date.now());
    const onCreateDraft = vi.fn();
    const onEditBlock = vi.fn();
    const onChangeDraft = vi.fn();
    const onSaveDraft = vi.fn();
    const onDeleteDraft = vi.fn();

    const { container, rerender } = render(
      <WeekView
        role="provider"
        blocks={[buildEditableBlock(dayKey)]}
        horizonDays={1}
        providerEdit={{
          mode: "availability",
          draft: null,
          onCreateDraft,
          onEditBlock,
          onChangeDraft,
          onSaveDraft,
          onDeleteDraft,
        }}
      />,
    );

    const canvas = setCanvasRect(container);
    fireEvent.click(canvas, { clientY: 180 });
    await user.click(screen.getByText("Open"));

    expect(onCreateDraft).toHaveBeenCalled();
    expect(onEditBlock).toHaveBeenCalled();

    rerender(
      <WeekView
        role="provider"
        blocks={[buildEditableBlock(dayKey)]}
        horizonDays={1}
        providerEdit={{
          mode: "availability",
          draft: buildDraft(dayKey, true),
          onCreateDraft,
          onEditBlock,
          onChangeDraft,
          onSaveDraft,
          onDeleteDraft,
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Save range" }));

    expect(onSaveDraft).toHaveBeenCalled();

    rerender(
      <WeekView
        role="provider"
        blocks={[buildEditableBlock(dayKey)]}
        horizonDays={1}
        providerEdit={{
          mode: "availability",
          draft: buildDraft(dayKey),
          onCreateDraft,
          onEditBlock,
          onChangeDraft,
          onSaveDraft,
          onDeleteDraft,
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Save range" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete range" }));

    expect(onDeleteDraft).toHaveBeenCalled();
  });

  it("updates provider drafts when moved or resized", () => {
    const dayKey = toDayKey(Date.now());
    const onChangeDraft = vi.fn();

    const { container } = render(
      <WeekView
        role="provider"
        blocks={[buildEditableBlock(dayKey)]}
        horizonDays={1}
        providerEdit={{
          mode: "availability",
          draft: buildDraft(dayKey),
          onCreateDraft: vi.fn(),
          onEditBlock: vi.fn(),
          onChangeDraft,
          onSaveDraft: vi.fn(),
          onDeleteDraft: vi.fn(),
        }}
      />,
    );

    setCanvasRect(container);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Move range" }), { clientY: 405 });
    fireEvent.pointerMove(window, { clientY: 450 });
    fireEvent.pointerUp(window);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Resize start" }), { clientY: 405 });
    fireEvent.pointerMove(window, { clientY: 360 });
    fireEvent.pointerUp(window);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Resize end" }), { clientY: 585 });
    fireEvent.pointerMove(window, { clientY: 630 });
    fireEvent.pointerUp(window);

    expect(onChangeDraft).toHaveBeenCalled();
    expect(onChangeDraft.mock.calls.some(([draft]) => draft.startMinutes !== 9 * 60)).toBe(true);
    expect(onChangeDraft.mock.calls.some(([draft]) => draft.endMinutes !== 13 * 60)).toBe(true);
  });

  it("updates new client booking drafts in the planner and saves inline", async () => {
    const user = userEvent.setup();
    const dayKey = toDayKey(Date.now());
    const onChangeDraft = vi.fn();
    const onConfirmDraft = vi.fn();

    const { container } = render(
      <WeekView
        role="client"
        blocks={[buildEditableBlock(dayKey)]}
        selectedDraft={buildBookingDraft(dayKey)}
        horizonDays={1}
        bookingEdit={{
          draft: buildBookingDraft(dayKey),
          bounds: {
            dayKey,
            dayStart: new Date(`${dayKey}T00:00:00`).getTime(),
            minStartMinutes: 9 * 60,
            maxEndMinutes: 13 * 60,
            minDurationMinutes: 60,
          },
          onChangeDraft,
          onConfirmDraft,
          onDeleteDraft: vi.fn(),
          isNewDraft: true,
        }}
      />,
    );

    setCanvasRect(container);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Move booking" }), { clientY: 180 });
    fireEvent.pointerMove(window, { clientY: 225 });
    fireEvent.pointerUp(window);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Resize booking end" }), { clientY: 270 });
    fireEvent.pointerMove(window, { clientY: 315 });
    fireEvent.pointerUp(window);

    await user.click(screen.getByRole("button", { name: "Save booking" }));

    expect(onChangeDraft).toHaveBeenCalled();
    expect(onChangeDraft.mock.calls.some(([draft]) => draft.guaranteedStartAt !== buildBookingDraft(dayKey).guaranteedStartAt)).toBe(
      true,
    );
    expect(onChangeDraft.mock.calls.some(([draft]) => draft.endsAt !== buildBookingDraft(dayKey).endsAt)).toBe(true);
    expect(onConfirmDraft).toHaveBeenCalled();
  });

  it("shows save and delete controls when editing an existing booking", () => {
    const dayKey = toDayKey(Date.now());
    const onDeleteDraft = vi.fn();

    render(
      <WeekView
        role="client"
        blocks={[buildEditableBlock(dayKey)]}
        selectedDraft={buildBookingDraft(dayKey)}
        horizonDays={1}
        bookingEdit={{
          draft: buildBookingDraft(dayKey),
          bounds: {
            dayKey,
            dayStart: new Date(`${dayKey}T00:00:00`).getTime(),
            minStartMinutes: 9 * 60,
            maxEndMinutes: 13 * 60,
            minDurationMinutes: 60,
          },
          onChangeDraft: vi.fn(),
          onConfirmDraft: vi.fn(),
          onDeleteDraft,
          isNewDraft: false,
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Save booking" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete booking" })).toBeInTheDocument();
  });
});
