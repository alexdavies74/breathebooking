import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ProviderDashboardRoute } from "./ProviderDashboardRoute";
import { ProviderClientSettingsRoute } from "./ProviderClientSettingsRoute";

const mocks = vi.hoisted(() => ({
  useCurrentUser: vi.fn(),
  useParents: vi.fn(),
  useQuery: vi.fn(),
  useRow: vi.fn(),
  useSavedRow: vi.fn(),
  buildProviderWeekBlocks: vi.fn(() => []),
  createClient: vi.fn(),
  createPractice: vi.fn(),
  createBaseAvailabilityWindow: vi.fn(),
  createPersonalBlock: vi.fn(),
  deactivateBaseAvailabilityWindow: vi.fn(),
  deactivatePersonalBlock: vi.fn(),
  updateBaseAvailabilityWindow: vi.fn(),
  updateClientSettings: vi.fn(),
  updatePersonalBlock: vi.fn(),
}));

const {
  useCurrentUser,
  useParents,
  useQuery,
  useRow,
  useSavedRow,
  buildProviderWeekBlocks,
  createClient,
  createPractice,
  createBaseAvailabilityWindow,
  createPersonalBlock,
  deactivateBaseAvailabilityWindow,
  deactivatePersonalBlock,
  updateBaseAvailabilityWindow,
  updateClientSettings,
  updatePersonalBlock,
} = mocks;

vi.mock("@vennbase/react", () => ({
  useCurrentUser: (...args: unknown[]) => mocks.useCurrentUser(...args),
  useParents: (...args: unknown[]) => mocks.useParents(...args),
  useQuery: (...args: unknown[]) => mocks.useQuery(...args),
  useRow: (...args: unknown[]) => mocks.useRow(...args),
  useSavedRow: (...args: unknown[]) => mocks.useSavedRow(...args),
}));

vi.mock("../domain/actions", () => ({
  createBaseAvailabilityWindow: (...args: unknown[]) => mocks.createBaseAvailabilityWindow(...args),
  createClient: (...args: unknown[]) => mocks.createClient(...args),
  createPersonalBlock: (...args: unknown[]) => mocks.createPersonalBlock(...args),
  createPractice: (...args: unknown[]) => mocks.createPractice(...args),
  deactivateBaseAvailabilityWindow: (...args: unknown[]) => mocks.deactivateBaseAvailabilityWindow(...args),
  deactivatePersonalBlock: (...args: unknown[]) => mocks.deactivatePersonalBlock(...args),
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
  db: {
    createInviteToken: vi.fn(() => ({ value: { token: "invite-token" } })),
    createShareLink: vi.fn(() => "http://localhost/share?token=invite-token"),
  },
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

beforeEach(() => {
  vi.clearAllMocks();
  useCurrentUser.mockReturnValue({ data: { username: "owner" } });
  useSavedRow.mockReturnValue({ data: createProviderRow(), save: vi.fn() });
  useParents.mockReturnValue({ data: [{ id: "provider-1", collection: "providers", baseUrl: "http://localhost" }] });
  useRow.mockReturnValue({ data: createClientRow() });
  useQuery.mockImplementation((_db: unknown, collection: string) => {
    if (collection === "clients") {
      return { rows: [createClientRow()] };
    }

    return { rows: [] };
  });
  createClient.mockResolvedValue({
    client: createClientRow(),
    inviteLink: "http://localhost/invite?clientId=client-1",
  });
});

describe("provider routes", () => {
  it("creates a client from name only and links to client settings", async () => {
    const user = userEvent.setup();
    const provider = createProviderRow();
    useSavedRow.mockReturnValue({ data: provider, save: vi.fn() });

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

    expect(createClient).toHaveBeenCalledWith(provider, { fullName: "Casey Client" });
    expect(await screen.findByText("Client settings route")).toBeInTheDocument();
  });

  it("denies access to client settings for non-owners", () => {
    useCurrentUser.mockReturnValue({ data: { username: "someone-else" } });

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

  it("allows client settings when parent lookup is empty but the client is in the provider roster", () => {
    useParents.mockReturnValue({ data: [] });

    render(
      <MemoryRouter initialEntries={["/provider/clients/client-1/settings"]}>
        <Routes>
          <Route path="/provider/clients/:clientId/settings" element={<ProviderClientSettingsRoute session={createSession() as never} />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "Save settings" })).toBeInTheDocument();
  });

  it("shows the invite link and QR on the client settings page", async () => {
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
});
