import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ClientHomeRoute } from "./ClientHomeRoute";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useRow: vi.fn(),
  createSessionBooking: vi.fn(),
  cancelSession: vi.fn(),
}));

vi.mock("@vennbase/react", () => ({
  useQuery: (...args: unknown[]) => mocks.useQuery(...args),
  useRow: (...args: unknown[]) => mocks.useRow(...args),
}));

vi.mock("../domain/actions", () => ({
  createSessionBooking: (...args: unknown[]) => mocks.createSessionBooking(...args),
  cancelSession: (...args: unknown[]) => mocks.cancelSession(...args),
}));

vi.mock("../lib/db", () => ({
  db: {},
}));

function createSession() {
  return {
    session: { signedIn: true },
    signIn: vi.fn(),
  };
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

describe("ClientHomeRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
