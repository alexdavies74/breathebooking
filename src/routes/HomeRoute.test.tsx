import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomeRoute } from "./HomeRoute";
import type { ClientWorkspaceAccess } from "../lib/clientAccess";

const mocks = vi.hoisted(() => ({
  useSavedRow: vi.fn(),
  loadClientAccessList: vi.fn(),
}));

vi.mock("@vennbase/react", () => ({
  useSavedRow: (...args: unknown[]) => mocks.useSavedRow(...args),
}));

vi.mock("../lib/clientAccess", async () => {
  const actual = await vi.importActual<typeof import("../lib/clientAccess")>("../lib/clientAccess");
  return {
    ...actual,
    loadClientAccessList: (...args: unknown[]) => mocks.loadClientAccessList(...args),
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

function createClientAccess(overrides: Partial<ClientWorkspaceAccess> = {}) {
  return {
    clientId: "client-1",
    clientName: "Casey Client",
    providerId: "provider-1",
    providerName: "Provider Practice",
    providerBaseUrl: "https://api.puter.com",
    lastOpenedAt: new Date("2026-03-29T12:00:00Z").getTime(),
    ...overrides,
  };
}

describe("HomeRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useSavedRow.mockReturnValue({ data: null, status: "success" });
    mocks.loadClientAccessList.mockResolvedValue([]);
  });

  it("redirects signed-in clients at the root URL to their saved booking home", async () => {
    mocks.loadClientAccessList.mockResolvedValue([createClientAccess()]);

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<HomeRoute session={createSession() as never} />} />
          <Route path="/client/:clientId" element={<div>Client page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Client page")).toBeInTheDocument();
    });
  });

  it("shows a client workspace picker when more than one relationship is saved", async () => {
    mocks.loadClientAccessList.mockResolvedValue([
      createClientAccess(),
      createClientAccess({
        clientId: "client-2",
        clientName: "Taylor Client",
        providerId: "provider-2",
        providerName: "Second Provider",
      }),
    ]);

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<HomeRoute session={createSession() as never} />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Select a client booking home")).toBeInTheDocument();
    });

    expect(screen.getByText("Casey Client")).toBeInTheDocument();
    expect(screen.getByText("Taylor Client")).toBeInTheDocument();
    expect(screen.getByText("Provider Practice")).toBeInTheDocument();
    expect(screen.getByText("Second Provider")).toBeInTheDocument();
  });
});
