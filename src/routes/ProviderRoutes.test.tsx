import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderDashboardRoute } from "./ProviderDashboardRoute";
import { ProviderClientSettingsRoute } from "./ProviderClientSettingsRoute";
import { toDayKey } from "../domain/date";

const mocks = vi.hoisted(() => ({
  useCurrentUser: vi.fn(),
  useQuery: vi.fn(),
  useRow: vi.fn(),
  useSavedRow: vi.fn(),
  useShareLink: vi.fn(),
  buildProviderWeekBlocks: vi.fn(() => []),
  createClient: vi.fn(),
  createPractice: vi.fn(),
  createBaseAvailabilityWindow: vi.fn(),
  createPersonalBlock: vi.fn(),
  deactivateBaseAvailabilityWindow: vi.fn(),
  deactivatePersonalBlock: vi.fn(),
  getBookingRootRef: vi.fn(),
  updateBaseAvailabilityWindow: vi.fn(),
  updateClientSettings: vi.fn(),
  updatePersonalBlock: vi.fn(),
}));

vi.mock("@vennbase/react", () => ({
  useCurrentUser: (...args: unknown[]) => mocks.useCurrentUser(...args),
  useQuery: (...args: unknown[]) => mocks.useQuery(...args),
  useRow: (...args: unknown[]) => mocks.useRow(...args),
  useSavedRow: (...args: unknown[]) => mocks.useSavedRow(...args),
  useShareLink: (...args: unknown[]) => mocks.useShareLink(...args),
}));

vi.mock("../domain/actions", () => ({
  createBaseAvailabilityWindow: (...args: unknown[]) => mocks.createBaseAvailabilityWindow(...args),
  createClient: (...args: unknown[]) => mocks.createClient(...args),
  createPersonalBlock: (...args: unknown[]) => mocks.createPersonalBlock(...args),
  createPractice: (...args: unknown[]) => mocks.createPractice(...args),
  deactivateBaseAvailabilityWindow: (...args: unknown[]) => mocks.deactivateBaseAvailabilityWindow(...args),
  deactivatePersonalBlock: (...args: unknown[]) => mocks.deactivatePersonalBlock(...args),
  getBookingRootRef: (...args: unknown[]) => mocks.getBookingRootRef(...args),
  updateBaseAvailabilityWindow: (...args: unknown[]) => mocks.updateBaseAvailabilityWindow(...args),
  updateClientSettings: (...args: unknown[]) => mocks.updateClientSettings(...args),
  updatePersonalBlock: (...args: unknown[]) => mocks.updatePersonalBlock(...args),
}));

vi.mock("../domain/availability", () => ({
  buildProviderWeekBlocks: mocks.buildProviderWeekBlocks,
}));

vi.mock("../domain/calendarSync", () => ({
  manualCalendarSyncAdapter: {
    getStatus: vi.fn().mockResolvedValue({ enabled: false }),
  },
}));

vi.mock("../lib/db", () => ({
  db: {},
}));

vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,test"),
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

function createPrivateRootRow() {
  return {
    id: "private-root-1",
    ref: { id: "private-root-1", collection: "providerPrivateRoots", baseUrl: "http://localhost" },
    fields: {
      providerRef: { id: "provider-1", collection: "providers", baseUrl: "http://localhost" },
      createdAt: Date.now(),
    },
  };
}

function createClientRow() {
  return {
    id: "client-1",
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

function setCanvasRect(container: HTMLElement) {
  container.querySelectorAll(".day-column__canvas").forEach((canvas) => {
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
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  const provider = createProviderRow();
  const privateRoot = createPrivateRootRow();

  mocks.useCurrentUser.mockReturnValue({ data: { username: "owner" } });
  mocks.useSavedRow.mockReturnValue({ data: provider, save: vi.fn(), status: "success" });
  mocks.useShareLink.mockReturnValue({ shareLink: "http://localhost/share?token=invite-token", status: "success" });
  mocks.useRow.mockImplementation((_db: unknown, ref: { collection: string } | null | undefined) => {
    if (!ref) {
      return { data: null, status: "success" };
    }

    if (ref.collection === "providerPrivateRoots") {
      return { data: privateRoot, status: "success" };
    }

    return { data: null, status: "success" };
  });
  mocks.useQuery.mockImplementation((_db: unknown, collection: string) => {
    if (collection === "clients") {
      return { rows: [createClientRow()], status: "success" };
    }

    return { rows: [], status: "success" };
  });
  mocks.getBookingRootRef.mockReturnValue({
    id: "booking-root-1",
    collection: "bookingRoots",
    baseUrl: "http://localhost",
  });
  mocks.createClient.mockResolvedValue({
    client: createClientRow(),
    inviteLink: "http://localhost/invite?clientId=client-1",
  });
});

describe("provider routes", () => {
  it("creates a client from name only and links to client settings", async () => {
    const user = userEvent.setup();
    const provider = createProviderRow();
    mocks.useSavedRow.mockReturnValue({ data: provider, save: vi.fn(), status: "success" });

    render(
      <MemoryRouter initialEntries={["/provider"]}>
        <Routes>
          <Route path="/provider" element={<ProviderDashboardRoute session={createSession() as never} />} />
          <Route path="/provider/clients/:clientId/settings" element={<div>Client settings route</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("Name"), "Casey Client");
    await user.click(screen.getByRole("button", { name: "Create client" }));

    expect(mocks.createClient).toHaveBeenCalledWith(provider, { fullName: "Casey Client" });
    expect(await screen.findByText("Client settings route")).toBeInTheDocument();
  });

  it("denies access to client settings for non-owners", () => {
    mocks.useCurrentUser.mockReturnValue({ data: { username: "someone-else" } });

    render(
      <MemoryRouter initialEntries={["/provider/clients/client-1/settings"]}>
        <Routes>
          <Route path="/provider/clients/:clientId/settings" element={<ProviderClientSettingsRoute session={createSession() as never} />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Access denied")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save settings" })).not.toBeInTheDocument();
  });

  it("shows the client invite link and QR on the client settings page", async () => {
    render(
      <MemoryRouter initialEntries={["/provider/clients/client-1/settings"]}>
        <Routes>
          <Route path="/provider/clients/:clientId/settings" element={<ProviderClientSettingsRoute session={createSession() as never} />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /http:\/\/localhost\/invite\?/i })).toHaveAttribute(
      "href",
      expect.stringContaining("/invite?"),
    );
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    expect(await screen.findByAltText("Invite QR code")).toBeInTheDocument();
  });

  it("saves edits to existing provider ranges from the save button", async () => {
    const user = userEvent.setup();
    const dayKey = toDayKey(Date.now());

    mocks.buildProviderWeekBlocks.mockReturnValue([
      {
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
      },
    ] as never);
    mocks.useQuery.mockImplementation((_db: unknown, collection: string) => {
      if (collection === "clients") {
        return { rows: [createClientRow()], status: "success" };
      }

      if (collection === "baseAvailabilityWindows") {
        return {
          rows: [
            {
              id: "window-1",
              ref: { id: "window-1", collection: "baseAvailabilityWindows", baseUrl: "http://localhost" },
              fields: {
                weekday: new Date(`${dayKey}T00:00:00`).getDay(),
                startMinutes: 9 * 60,
                endMinutes: 13 * 60,
                status: "active",
                sortKey: 1,
              },
            },
          ],
          status: "success",
        };
      }

      return { rows: [], status: "success" };
    });
    mocks.updateBaseAvailabilityWindow.mockResolvedValue({});

    const { container } = render(
      <MemoryRouter initialEntries={["/provider"]}>
        <Routes>
          <Route path="/provider" element={<ProviderDashboardRoute session={createSession() as never} />} />
        </Routes>
      </MemoryRouter>,
    );

    setCanvasRect(container);

    await user.click(screen.getByText("Open"));

    expect(screen.getByRole("button", { name: "Save range" })).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Move range" }), { clientY: 405 });
    fireEvent.pointerMove(window, { clientY: 450 });
    fireEvent.pointerUp(window);

    await user.click(screen.getByRole("button", { name: "Save range" }));

    expect(mocks.updateBaseAvailabilityWindow).toHaveBeenCalledWith(
      expect.objectContaining({ id: "window-1" }),
      expect.objectContaining({ startMinutes: 10 * 60, endMinutes: 14 * 60 }),
    );
  });
});
