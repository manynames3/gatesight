import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const oidc = vi.hoisted(() => {
  const manager = {
    events: {
      addSilentRenewError: vi.fn(),
      addUserLoaded: vi.fn(),
      addUserUnloaded: vi.fn(),
      removeSilentRenewError: vi.fn(),
      removeUserLoaded: vi.fn(),
      removeUserUnloaded: vi.fn(),
    },
    getUser: vi.fn().mockResolvedValue(null),
    removeUser: vi.fn().mockResolvedValue(undefined),
    signinRedirect: vi.fn(),
    signinSilent: vi.fn(),
    signoutRedirect: vi.fn(),
  };
  return { manager };
});

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
}));

vi.mock("oidc-client-ts", () => ({
  UserManager: class {
    constructor() {
      return oidc.manager;
    }
  },
  WebStorageStateStore: class {},
}));

vi.mock("./logout", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    replaceWithCognitoLogout: navigation.replace,
  };
});

import { AuthProvider, useAuth } from "./AuthProvider";

function Harness() {
  const { ready, signOut } = useAuth();
  return (
    <button type="button" disabled={!ready} onClick={() => void signOut()}>
      Sign out
    </button>
  );
}

describe("AuthProvider sign out", () => {
  beforeEach(() => {
    vi.stubEnv(
      "VITE_COGNITO_AUTHORITY",
      "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test",
    );
    vi.stubEnv("VITE_COGNITO_CLIENT_ID", "public-client");
    vi.stubEnv("VITE_COGNITO_REDIRECT_URI", "https://gatesight.pages.dev/auth/callback");
    vi.stubEnv("VITE_COGNITO_LOGOUT_URI", "https://gatesight.pages.dev/sign-in");
    vi.stubEnv(
      "VITE_COGNITO_DOMAIN",
      "https://example.auth.us-east-1.amazoncognito.com",
    );
    oidc.manager.getUser.mockResolvedValue(null);
    oidc.manager.removeUser.mockResolvedValue(undefined);
    window.sessionStorage.setItem("oidc-test", "stored");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    window.sessionStorage.clear();
  });

  it("clears local state and uses Cognito's managed logout endpoint", async () => {
    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    );

    const button = screen.getByRole("button", { name: "Sign out" });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);

    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith(
        "https://example.auth.us-east-1.amazoncognito.com/logout?client_id=public-client&logout_uri=https%3A%2F%2Fgatesight.pages.dev%2Fsign-in",
      ),
    );
    expect(oidc.manager.removeUser).toHaveBeenCalledOnce();
    expect(oidc.manager.signoutRedirect).not.toHaveBeenCalled();
    expect(window.sessionStorage).toHaveLength(0);
  });

  it("continues remote logout when local OIDC cleanup fails", async () => {
    oidc.manager.removeUser.mockRejectedValueOnce(new Error("storage failed"));
    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    );

    const button = screen.getByRole("button", { name: "Sign out" });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledOnce());
    expect(window.sessionStorage).toHaveLength(0);
  });
});
