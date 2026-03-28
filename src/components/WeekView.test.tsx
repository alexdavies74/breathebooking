import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WeekView } from "./WeekView";
import { toDayKey } from "../domain/date";

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
            sessionRef: { id: "session-1", collection: "sessions", baseUrl: "http://localhost" },
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
});
