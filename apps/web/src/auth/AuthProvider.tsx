import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";

import { cognitoLogoutUrl, replaceWithCognitoLogout } from "./logout";

interface AuthValue {
  user: User | null;
  ready: boolean;
  configured: boolean;
  authError: string | null;
  getApiToken: (forceRefresh?: boolean) => Promise<string | undefined>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);
const SESSION_RENEWAL_ERROR =
  "Your secure session expired and could not be renewed. Please sign in again.";
const SESSION_RESTORE_ERROR =
  "Your saved session could not be restored. Please sign in again.";
const CALLBACK_ERROR =
  "Secure sign-in could not be completed. Please try signing in again.";
const INITIALIZATION_ERROR =
  "Secure sign-in could not be initialized in this browser. Check that session storage is available and try again.";

function makeManager(): UserManager | null {
  const {
    VITE_COGNITO_AUTHORITY: authority,
    VITE_COGNITO_CLIENT_ID: clientId,
    VITE_COGNITO_REDIRECT_URI: redirectUri,
    VITE_COGNITO_LOGOUT_URI: logoutUri,
  } = import.meta.env;
  if (!authority || !clientId || !redirectUri || !logoutUri) return null;
  return new UserManager({
    authority,
    client_id: clientId,
    redirect_uri: redirectUri,
    post_logout_redirect_uri: logoutUri,
    response_type: "code",
    scope: "openid email profile",
    automaticSilentRenew: true,
    accessTokenExpiringNotificationTimeInSeconds: 60,
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
    monitorSession: false,
  });
}

export function AuthProvider({ children }: PropsWithChildren) {
  const initialization = useMemo(() => {
    try {
      return { manager: makeManager(), error: null };
    } catch {
      return { manager: null, error: INITIALIZATION_ERROR };
    }
  }, []);
  const { manager } = initialization;
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(initialization.error);
  const renewalRef = useRef<Promise<User | null> | null>(null);

  const renewSession = useCallback(async () => {
    if (!manager) return null;
    renewalRef.current ??= manager
      .signinSilent()
      .then((renewed) => {
        setUser(renewed);
        setAuthError(null);
        return renewed;
      })
      .catch(async () => {
        await manager.removeUser().catch(() => undefined);
        setUser(null);
        setAuthError(SESSION_RENEWAL_ERROR);
        return null;
      });
    try {
      return await renewalRef.current;
    } finally {
      renewalRef.current = null;
    }
  }, [manager]);

  const getApiToken = useCallback(
    async (forceRefresh = false) => {
      if (!manager) return undefined;
      try {
        let current = await manager.getUser(false);
        const expiresSoon = current?.expires_in !== undefined && current.expires_in <= 60;
        if (current && (forceRefresh || current.expired || expiresSoon)) {
          current = await renewSession();
        }
        if (!current || current.expired) {
          setUser(null);
          return undefined;
        }
        setUser((existing) =>
          existing?.id_token === current.id_token ? existing : current,
        );
        // Cognito custom tenant/facility attributes are verified ID-token claims.
        return current.id_token;
      } catch {
        await manager.removeUser().catch(() => undefined);
        setUser(null);
        setAuthError(SESSION_RENEWAL_ERROR);
        return undefined;
      }
    },
    [manager, renewSession],
  );

  useEffect(() => {
    let active = true;
    async function restore() {
      if (!manager) {
        setReady(true);
        return;
      }
      const completingCallback = window.location.pathname === "/auth/callback";
      try {
        let restored = completingCallback
          ? await manager.signinRedirectCallback()
          : await manager.getUser();
        if (completingCallback) window.history.replaceState({}, "", "/");
        if (restored?.expired) restored = await renewSession();
        if (active) {
          setUser(restored);
          if (restored) setAuthError(null);
        }
      } catch {
        await manager.removeUser().catch(() => undefined);
        if (completingCallback) window.history.replaceState({}, "", "/sign-in");
        if (active) {
          setUser(null);
          setAuthError(completingCallback ? CALLBACK_ERROR : SESSION_RESTORE_ERROR);
        }
      } finally {
        if (active) setReady(true);
      }
    }
    void restore();
    return () => {
      active = false;
    };
  }, [manager, renewSession]);

  useEffect(() => {
    if (!manager) return;
    const loaded = (loadedUser: User) => {
      setUser(loadedUser);
      setAuthError(null);
    };
    const unloaded = () => setUser(null);
    const renewalFailed = () => {
      void manager
        .removeUser()
        .catch(() => undefined)
        .finally(() => {
          setUser(null);
          setAuthError(SESSION_RENEWAL_ERROR);
        });
    };
    manager.events.addUserLoaded(loaded);
    manager.events.addUserUnloaded(unloaded);
    manager.events.addSilentRenewError(renewalFailed);
    return () => {
      manager.events.removeUserLoaded(loaded);
      manager.events.removeUserUnloaded(unloaded);
      manager.events.removeSilentRenewError(renewalFailed);
    };
  }, [manager]);

  const signIn = useCallback(async () => {
    if (!manager) throw new Error("Cognito configuration is missing");
    setAuthError(null);
    await manager.signinRedirect();
  }, [manager]);

  const signOut = useCallback(async () => {
    if (!manager) return;
    const {
      VITE_COGNITO_DOMAIN: cognitoDomain,
      VITE_COGNITO_CLIENT_ID: clientId,
      VITE_COGNITO_LOGOUT_URI: logoutUri,
    } = import.meta.env;
    if (!cognitoDomain || !clientId || !logoutUri) {
      setAuthError(INITIALIZATION_ERROR);
      return;
    }
    let destination: string;
    try {
      destination = cognitoLogoutUrl({ cognitoDomain, clientId, logoutUri });
    } catch {
      setAuthError(INITIALIZATION_ERROR);
      return;
    }
    await manager.removeUser().catch(() => undefined);
    try {
      window.sessionStorage.clear();
    } catch {
      // Remote Cognito logout must still proceed if browser storage becomes unavailable.
    }
    setUser(null);
    replaceWithCognitoLogout(destination);
  }, [manager]);

  return (
    <AuthContext.Provider
      value={{
        user,
        ready,
        configured: manager !== null,
        authError,
        getApiToken,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// The hook intentionally shares the provider's context module.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
