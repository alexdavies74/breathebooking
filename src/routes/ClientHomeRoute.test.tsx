import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ClientHomeRoute } from "./ClientHomeRoute";
import { formatDayLabel, formatTime } from "../domain/date";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useRow: vi.fn(),
  createSessionBooking: vi.fn(),
  updateSessionBooking: vi.fn(),
  cancelSession: vi.fn(),
  findSavedClientAccess: vi.fn(),
  saveClientAccess: vi.fn(),
}));

vi.mock("@vennbase/react", () => ({
  useQuery: (...args: unknown[]) => mocks.useQuery(...args),
  useRow: (...args: unknown[]) => mocks.useRow(...args),
}));

vi.mock("../domain/actions", () => ({
  createSessionBooking: (...args: unknown[]) => mocks.createSessionBooking(...args),
  updateSessionBooking: (...args: unknown[]) => mocks.updateSessionBooking(...args),
  cancelSession: (...args: unknown[]) => mocks.cancelSession(...args),
}));

vi.mock("../lib/clientAccess", async () => {
  const actual = await vi.importActual<typeof import("../lib/clientAccess")>("../lib/clientAccess");
  return {
    ...actual,
    findSavedClientAccess: (...args: unknown[]) => mocks.findSavedClientAccess(...args),
    saveClientAccess: (...args: unknown[]) => mocks.saveClientAccess(...args),
  };
});

vi.mock("../lib/db", () => ({
  db: {},
}));

function createSession() {
  return {
    session: { signedIn: true },
    signIn: vi.fn(),
  };
}

function escapeForRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createProviderRow() {
  return {
    id: "provider-1",
    ref: { id: "provider-1", collection: "providers", baseUrl: "http://localhost" },
    fields: {
      displayName: "Provider Practice",
      timezone: "America/Los_Angeles",
      ownerUsername: "owner",
      defaultWeekHorizon: 4,
    },
  };
}

function createClientRow() {
  return {
    id: "client-1",
    ref: { id: "client-1", collection: "clients", baseUrl: "http://localhost" },
    fields: {
      fullName: "Casey Client",
      status: "active",
      minimumDurationMinutes: 180,
      travelTimeMinutes: 30,
    },
  };
}

function createAvailabilityRow(id: string, weekday: number, startMinutes: number) {
  return {
    id,
    ref: { id, collection: "baseAvailabilityWindows", baseUrl: "http://localhost" },
    fields: {
      weekday,
      startMinutes,
      endMinutes: startMinutes + 5 * 60,
      status: "active",
      sortKey: weekday * 1000 + startMinutes,
    },
  };
}

function createSessionRow(id: string, guaranteedStartAt: number) {
  return {
    id,
    ref: { id, collection: "sessions", baseUrl: "http://localhost" },
    fields: {
      startsAt: guaranteedStartAt,
      guaranteedStartAt,
      earliestStartAt: undefined,
      durationMinutes: 180,
      status: "confirmed",
      bookedByRole: "client",
      slotLabel: `${formatDayLabel(guaranteedStartAt)} · ${formatTime(guaranteedStartAt)}`,
    },
  };
}

describe("ClientHomeRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findSavedClientAccess.mockResolvedValue(null);
    mocks.saveClientAccess.mockResolvedValue([]);
    const provider = createProviderRow();
    const client = createClientRow();

    mocks.useRow.mockImplementation((_db: unknown, ref: { collection: string } | null | undefined) => {
      if (!ref) {
        return { data: null };
      }

      if (ref.collection === "providers") {
        return { data: provider };
      }

      return { data: null };
    });
    mocks.useQuery.mockImplementation((_db: unknown, collection: string) => {
      if (collection === "clients") {
        return {
          rows: [client],
        };
      }

      if (collection === "baseAvailabilityWindows") {
        return {
          rows: [1, 2, 3, 4, 5].flatMap((weekday) => [
            createAvailabilityRow(`window-${weekday}-am`, weekday, 8 * 60),
            createAvailabilityRow(`window-${weekday}-pm`, weekday, 14 * 60),
          ]),
        };
      }

      return { rows: [] };
    });
  });

  it("renders provider availability when travel and minimum fit within 5h windows", () => {
    render(
      <MemoryRouter initialEntries={["/client/client-1?providerId=provider-1&providerBaseUrl=https%3A%2F%2Fapi.puter.com"]}>
        <Routes>
          <Route path="/client/:clientId" element={<ClientHomeRoute session={createSession() as never} />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getAllByText("Mon, Mar 30 open")).toHaveLength(2);
    expect(screen.getAllByText(/open$/).length).toBeGreaterThan(0);
  });

  it("persists the resolved client workspace for future root visits", async () => {
    render(
      <MemoryRouter initialEntries={["/client/client-1?providerId=provider-1&providerBaseUrl=https%3A%2F%2Fapi.puter.com"]}>
        <Routes>
          <Route path="/client/:clientId" element={<ClientHomeRoute session={createSession() as never} />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findAllByText("Mon, Mar 30 open");

    expect(mocks.saveClientAccess).toHaveBeenCalledWith({
      clientId: "client-1",
      clientName: "Casey Client",
      providerId: "provider-1",
      providerName: "Provider Practice",
      providerBaseUrl: "http://localhost",
    });
  });

  it("opens a saved client workspace even when the query params are missing", async () => {
    mocks.findSavedClientAccess.mockResolvedValue({
      clientId: "client-1",
      clientName: "Casey Client",
      providerId: "provider-1",
      providerName: "Provider Practice",
      providerBaseUrl: "https://api.puter.com",
      lastOpenedAt: new Date("2026-03-29T12:00:00Z").getTime(),
    });

    render(
      <MemoryRouter initialEntries={["/client/client-1"]}>
        <Routes>
          <Route path="/client/:clientId" element={<ClientHomeRoute session={createSession() as never} />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findAllByText("Mon, Mar 30 open")).toHaveLength(2);
    expect(mocks.findSavedClientAccess).toHaveBeenCalledWith("client-1");
  });

  it("confirms bookings from the planner instead of showing duplicate range sliders", async () => {
    const user = userEvent.setup();
    mocks.createSessionBooking.mockResolvedValue({});

    render(
      <MemoryRouter initialEntries={["/client/client-1?providerId=provider-1&providerBaseUrl=https%3A%2F%2Fapi.puter.com"]}>
        <Routes>
          <Route path="/client/:clientId" element={<ClientHomeRoute session={createSession() as never} />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getAllByText("Mon, Mar 30 open")[0]);

    expect(screen.queryByLabelText("Start")).toBeNull();
    expect(screen.queryByLabelText("End")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(mocks.createSessionBooking).toHaveBeenCalledTimes(1);
  });

  it("suggests rebooking one week later instead of the same date", () => {
    const latestStartAt = new Date("2026-03-30T14:00:00").getTime();
    mocks.useQuery.mockImplementation((_db: unknown, collection: string) => {
      if (collection === "clients") {
        return {
          rows: [createClientRow()],
        };
      }

      if (collection === "baseAvailabilityWindows") {
        return {
          rows: [1, 2, 3, 4, 5].flatMap((weekday) => [
            createAvailabilityRow(`window-${weekday}-am`, weekday, 8 * 60),
            createAvailabilityRow(`window-${weekday}-pm`, weekday, 14 * 60),
          ]),
        };
      }

      if (collection === "sessions") {
        return {
          rows: [createSessionRow("session-1", latestStartAt)],
        };
      }

      return { rows: [] };
    });

    render(
      <MemoryRouter initialEntries={["/client/client-1?providerId=provider-1&providerBaseUrl=https%3A%2F%2Fapi.puter.com"]}>
        <Routes>
          <Route path="/client/:clientId" element={<ClientHomeRoute session={createSession() as never} />} />
        </Routes>
      </MemoryRouter>,
    );

    const suggestedStartAt = new Date("2026-04-06T14:00:00").getTime();
    expect(
      screen.getByText(
        `Book ${new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(suggestedStartAt)} ${formatTime(
          suggestedStartAt,
        )} again on ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(suggestedStartAt)}?`,
      ),
    ).toBeInTheDocument();
  });

  it("books the matching slot one week later from the recommendation card", async () => {
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(new Date("2026-03-29T12:00:00").getTime());
    try {
      const user = userEvent.setup();
      mocks.createSessionBooking.mockResolvedValue({});
      const latestStartAt = new Date("2026-03-30T14:00:00").getTime();

      mocks.useQuery.mockImplementation((_db: unknown, collection: string) => {
        if (collection === "clients") {
          return {
            rows: [createClientRow()],
          };
        }

        if (collection === "baseAvailabilityWindows") {
          return {
            rows: [1, 2, 3, 4, 5].flatMap((weekday) => [
              createAvailabilityRow(`window-${weekday}-am`, weekday, 8 * 60),
              createAvailabilityRow(`window-${weekday}-pm`, weekday, 14 * 60),
            ]),
          };
        }

        if (collection === "sessions") {
          return {
            rows: [createSessionRow("session-1", latestStartAt)],
          };
        }

        return { rows: [] };
      });

      render(
        <MemoryRouter initialEntries={["/client/client-1?providerId=provider-1&providerBaseUrl=https%3A%2F%2Fapi.puter.com"]}>
          <Routes>
            <Route path="/client/:clientId" element={<ClientHomeRoute session={createSession() as never} />} />
          </Routes>
        </MemoryRouter>,
      );

      await user.click(screen.getByRole("button", { name: "Book it" }));

      expect(mocks.createSessionBooking).toHaveBeenCalledWith(
        expect.objectContaining({
          draft: expect.objectContaining({
            guaranteedStartAt: new Date("2026-04-06T14:00:00").getTime(),
          }),
        }),
      );
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it("updates a selected session from the client planner", async () => {
    const user = userEvent.setup();
    mocks.updateSessionBooking.mockResolvedValue({});
    const sessionStartAt = new Date("2026-03-30T10:00:00").getTime();

    mocks.useQuery.mockImplementation((_db: unknown, collection: string) => {
      if (collection === "clients") {
        return {
          rows: [createClientRow()],
        };
      }

      if (collection === "baseAvailabilityWindows") {
        return {
          rows: [createAvailabilityRow("window-1", 1, 8 * 60)],
        };
      }

      if (collection === "sessions") {
        return {
          rows: [createSessionRow("session-1", sessionStartAt)],
        };
      }

      if (collection === "publicBusyWindows") {
        return {
          rows: [
            {
              id: "busy-1",
              ref: { id: "busy-1", collection: "publicBusyWindows", baseUrl: "http://localhost" },
              fields: {
                startsAt: sessionStartAt,
                endsAt: sessionStartAt + 180 * 60 * 1000,
                kind: "session",
                originRef: "session-1",
                label: `${formatDayLabel(sessionStartAt)} · ${formatTime(sessionStartAt)}`,
              },
            },
          ],
        };
      }

      return { rows: [] };
    });

    render(
      <MemoryRouter initialEntries={["/client/client-1?providerId=provider-1&providerBaseUrl=https%3A%2F%2Fapi.puter.com"]}>
        <Routes>
          <Route path="/client/:clientId" element={<ClientHomeRoute session={createSession() as never} />} />
        </Routes>
      </MemoryRouter>,
    );

    const sessionLabel = `${formatDayLabel(sessionStartAt)} · ${formatTime(sessionStartAt)}`;
    await user.click(screen.getByRole("button", { name: new RegExp(escapeForRegExp(sessionLabel)) }));
    await user.click(screen.getByRole("button", { name: "Update" }));

    expect(mocks.updateSessionBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({ id: "session-1" }),
        draft: expect.objectContaining({
          guaranteedStartAt: sessionStartAt,
          durationMinutes: 180,
        }),
      }),
    );
  });

  it("cancels a selected session from edit mode", async () => {
    const user = userEvent.setup();
    mocks.cancelSession.mockResolvedValue({});
    const sessionStartAt = new Date("2026-03-30T10:00:00").getTime();

    mocks.useQuery.mockImplementation((_db: unknown, collection: string) => {
      if (collection === "clients") {
        return {
          rows: [createClientRow()],
        };
      }

      if (collection === "baseAvailabilityWindows") {
        return {
          rows: [createAvailabilityRow("window-1", 1, 8 * 60)],
        };
      }

      if (collection === "sessions") {
        return {
          rows: [createSessionRow("session-1", sessionStartAt)],
        };
      }

      return { rows: [] };
    });

    render(
      <MemoryRouter initialEntries={["/client/client-1?providerId=provider-1&providerBaseUrl=https%3A%2F%2Fapi.puter.com"]}>
        <Routes>
          <Route path="/client/:clientId" element={<ClientHomeRoute session={createSession() as never} />} />
        </Routes>
      </MemoryRouter>,
    );

    const sessionLabel = `${formatDayLabel(sessionStartAt)} · ${formatTime(sessionStartAt)}`;
    await user.click(screen.getByRole("button", { name: new RegExp(escapeForRegExp(sessionLabel)) }));
    await user.click(screen.getByRole("button", { name: "Cancel session" }));

    expect(mocks.cancelSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: "provider-1" }),
      expect.objectContaining({ id: "session-1" }),
    );
  });
});
