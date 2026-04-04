import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientHomeRoute } from "./ClientHomeRoute";
import { formatDayLabel, formatTime } from "../domain/date";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useRow: vi.fn(),
  createBooking: vi.fn(),
  updateBooking: vi.fn(),
  cancelBooking: vi.fn(),
  findSavedClientAccess: vi.fn(),
  saveClientAccess: vi.fn(),
  acceptInvite: vi.fn(),
  joinInvite: vi.fn(),
}));

vi.mock("@vennbase/core", () => ({
  CURRENT_USER: { __vennbase: "CURRENT_USER" },
}));

vi.mock("@vennbase/react", () => ({
  useQuery: (...args: unknown[]) => mocks.useQuery(...args),
  useRow: (...args: unknown[]) => mocks.useRow(...args),
}));

vi.mock("../domain/actions", () => ({
  createBooking: (...args: unknown[]) => mocks.createBooking(...args),
  updateBooking: (...args: unknown[]) => mocks.updateBooking(...args),
  cancelBooking: (...args: unknown[]) => mocks.cancelBooking(...args),
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
  db: {
    acceptInvite: (...args: unknown[]) => mocks.acceptInvite(...args),
    joinInvite: (...args: unknown[]) => mocks.joinInvite(...args),
  },
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
    collection: "providers",
    ref: { id: "provider-1", collection: "providers", baseUrl: "http://localhost" },
    fields: {
      displayName: "Provider Practice",
      timezone: "America/Los_Angeles",
      ownerUsername: "owner",
      defaultWeekHorizon: 4,
      bookingSubmitterLink: "http://localhost/join-bookings",
      privateRootRef: { id: "private-root-1", collection: "providerPrivateRoots", baseUrl: "http://localhost" },
    },
  };
}

function createClientRow() {
  return {
    id: "client-1",
    collection: "clients",
    ref: { id: "client-1", collection: "clients", baseUrl: "http://localhost" },
    fields: {
      fullName: "Casey Client",
      providerViewerLink: "http://localhost/open-provider",
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

function createSavedBookingRow(id: string, guaranteedStartAt: number) {
  return {
    id: `saved-${id}`,
    ref: { id: `saved-${id}`, collection: "savedBookings", baseUrl: "http://localhost" },
    fields: {
      clientRef: { id: "client-1", collection: "clients", baseUrl: "http://localhost" },
      bookingRef: { id, collection: "bookings", baseUrl: "http://localhost" },
      status: "active",
      startsAt: guaranteedStartAt,
      endsAt: guaranteedStartAt + 180 * 60 * 1000,
      guaranteedStartAt,
      earliestStartAt: undefined,
      durationMinutes: 180,
      bookedByRole: "client",
      slotLabel: `${formatDayLabel(guaranteedStartAt)} · ${formatTime(guaranteedStartAt)}`,
    },
  };
}

function createBookingKeyRow(id: string, startsAt: number, endsAt: number) {
  return {
    id,
    collection: "bookings",
    fields: {
      startsAt,
      endsAt,
    },
  };
}

describe("ClientHomeRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const provider = createProviderRow();
    const client = createClientRow();

    mocks.findSavedClientAccess.mockResolvedValue({
      clientId: "client-1",
      clientBaseUrl: "http://localhost",
      clientName: "Casey Client",
      providerName: "Provider Practice",
      lastOpenedAt: new Date("2026-03-29T12:00:00Z").getTime(),
    });
    mocks.saveClientAccess.mockResolvedValue([]);
    mocks.acceptInvite.mockResolvedValue(provider);
    mocks.joinInvite.mockResolvedValue({
      ref: { id: "booking-root-1", collection: "bookingRoots", baseUrl: "http://localhost" },
      role: "submitter",
    });
    mocks.useRow.mockImplementation((_db: unknown, ref: { collection: string } | null | undefined) => {
      if (!ref) {
        return { data: null };
      }

      if (ref.collection === "clients") {
        return { data: client };
      }

      if (ref.collection === "providers") {
        return { data: provider };
      }

      return { data: null };
    });
    mocks.useQuery.mockImplementation((_db: unknown, collection: string) => {
      if (collection === "baseAvailabilityWindows") {
        return {
          rows: [1, 2, 3, 4, 5].flatMap((weekday) => [
            createAvailabilityRow(`window-${weekday}-am`, weekday, 8 * 60),
            createAvailabilityRow(`window-${weekday}-pm`, weekday, 14 * 60),
          ]),
        };
      }

      if (collection === "bookings") {
        return {
          rows: [],
        };
      }

      if (collection === "bookingBlocks") {
        return {
          rows: [],
        };
      }

      if (collection === "savedBookings") {
        return {
          rows: [],
        };
      }

      if (collection === "rebookingPresets") {
        return {
          rows: [],
        };
      }

      return { rows: [] };
    });
  });

  it("opens the client row, then joins the provider viewer link and booking inbox, without querying provider clients", async () => {
    render(
      <MemoryRouter initialEntries={["/client/client-1"]}>
        <Routes>
          <Route path="/client/:clientId" element={<ClientHomeRoute session={createSession() as never} />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findAllByText(/open$/)).not.toHaveLength(0);
    await waitFor(() => {
      expect(mocks.joinInvite).toHaveBeenCalledWith("http://localhost/join-bookings");
    });
    expect(mocks.acceptInvite).toHaveBeenCalledWith("http://localhost/open-provider");
    expect(mocks.useQuery.mock.calls.map((call) => call[1])).not.toContain("clients");
  });

  it("uses index-key booking and block queries and persists resolved client access", async () => {
    render(
      <MemoryRouter initialEntries={["/client/client-1"]}>
        <Routes>
          <Route path="/client/:clientId" element={<ClientHomeRoute session={createSession() as never} />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findAllByText(/open$/);
    await waitFor(() => {
      expect(
        mocks.useQuery.mock.calls.find(
          ([, collection, options]) => collection === "bookings" && options?.select === "indexKeys",
        ),
      ).toBeTruthy();
      expect(
        mocks.useQuery.mock.calls.find(
          ([, collection, options]) => collection === "bookingBlocks" && options?.select === "indexKeys",
        ),
      ).toBeTruthy();
    });

    expect(mocks.saveClientAccess).toHaveBeenCalledWith({
      clientId: "client-1",
      clientBaseUrl: "http://localhost",
      clientName: "Casey Client",
      providerName: "Provider Practice",
    });
  });

  it("creates a booking under the booking root instead of writing under the provider", async () => {
    const user = userEvent.setup();
    mocks.createBooking.mockResolvedValue({});

    const { container } = render(
      <MemoryRouter initialEntries={["/client/client-1"]}>
        <Routes>
          <Route path="/client/:clientId" element={<ClientHomeRoute session={createSession() as never} />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findAllByText(/open$/);
    fireEvent.click(container.querySelector(".week-block--available") as HTMLElement);
    await user.click(screen.getByRole("button", { name: "Save booking" }));

    expect(mocks.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingRootRef: { id: "booking-root-1", collection: "bookingRoots", baseUrl: "http://localhost" },
        client: expect.objectContaining({ id: "client-1" }),
        bookedByRole: "client",
      }),
    );
  });

  it("updates and cancels only the current user's saved booking", async () => {
    const user = userEvent.setup();
    const bookingDay = new Date();
    bookingDay.setHours(14, 0, 0, 0);
    bookingDay.setDate(bookingDay.getDate() + 1);
    const bookingStartAt = bookingDay.getTime();
    mocks.updateBooking.mockResolvedValue({});
    mocks.cancelBooking.mockResolvedValue({});
    mocks.useQuery.mockImplementation((_db: unknown, collection: string) => {
      if (collection === "baseAvailabilityWindows") {
        return {
          rows: [1, 2, 3, 4, 5].flatMap((weekday) => [
            createAvailabilityRow(`window-${weekday}-am`, weekday, 8 * 60),
            createAvailabilityRow(`window-${weekday}-pm`, weekday, 14 * 60),
          ]),
        };
      }

      if (collection === "bookings") {
        return {
          rows: [createBookingKeyRow("booking-1", bookingStartAt, bookingStartAt + 180 * 60 * 1000)],
        };
      }

      if (collection === "bookingBlocks") {
        return { rows: [] };
      }

      if (collection === "savedBookings") {
        return {
          rows: [createSavedBookingRow("booking-1", bookingStartAt)],
        };
      }

      if (collection === "rebookingPresets") {
        return { rows: [] };
      }

      return { rows: [] };
    });

    const { container } = render(
      <MemoryRouter initialEntries={["/client/client-1"]}>
        <Routes>
          <Route path="/client/:clientId" element={<ClientHomeRoute session={createSession() as never} />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(container.querySelector(".week-block--booked-own")).toBeTruthy();
    });
    fireEvent.click(container.querySelector(".week-block--booked-own") as HTMLElement);
    fireEvent.click(container.querySelector(".week-block--available") as HTMLElement);
    await user.click(screen.getByRole("button", { name: "Save booking" }));

    expect(mocks.updateBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingRootRef: { id: "booking-root-1", collection: "bookingRoots", baseUrl: "http://localhost" },
        savedBooking: expect.objectContaining({
          fields: expect.objectContaining({
            bookingRef: expect.objectContaining({ id: "booking-1" }),
          }),
        }),
      }),
    );

    fireEvent.click(container.querySelector(".week-block--booked-own") as HTMLElement);
    await user.click(screen.getByRole("button", { name: "Cancel booking" }));

    expect(mocks.cancelBooking).toHaveBeenCalledWith({
      bookingRootRef: { id: "booking-root-1", collection: "bookingRoots", baseUrl: "http://localhost" },
      savedBooking: expect.objectContaining({
        fields: expect.objectContaining({
          bookingRef: expect.objectContaining({ id: "booking-1" }),
        }),
      }),
    });
  });
});
