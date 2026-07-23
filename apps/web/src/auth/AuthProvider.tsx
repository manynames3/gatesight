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

interface AuthValue {
  user: User | null;
  ready: boolean;
  configured: boolean;
  getAccessToken: (forceRefresh?: boolean) => Promise<string | undefined>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

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
  const manager = useMemo(() => makeManager(), []);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const renewalRef = useRef<Promise<User | null> | null>(null);

  const renewSession = useCallback(async () => {
    if (!manager) return null;
    renewalRef.current ??= manager
      .signinSilent()
      .then((renewed) => {
        setUser(renewed);
        return renewed;
      })
      .catch(() => null);
    try {
      return await renewalRef.current;
    } finally {
      renewalRef.current = null;
    }
  }, [manager]);

  const getAccessToken = useCallback(
    async (forceRefresh = false) => {
      if (!manager) return undefined;
      let current = await manager.getUser(false);
      const expiresSoon = current?.expires_in !== undefined && current.expires_in <= 60;
      if (current && (forceRefresh || current.expired || expiresSoon)) {
        current = await renewSession();
      }
      if (!current || current.expired) return undefined;
      setUser((existing) =>
        existing?.access_token === current.access_token ? existing : current,
      );
      return current.access_token;
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
      if (window.location.pathname === "/auth/callback") {
        await manager.signinRedirectCallback();
        window.history.replaceState({}, "", "/station");
      }
      let restored = await manager.getUser();
      if (restored?.expired) restored = await renewSession();
      if (active) {
        setUser(restored);
        setReady(true);
      }
    }
    void restore();
    return () => {
      active = false;
    };
  }, [manager, renewSession]);

  useEffect(() => {
    if (!manager) return;
    const loaded = (loadedUser: User) => setUser(loadedUser);
    const unloaded = () => setUser(null);
    manager.events.addUserLoaded(loaded);
    manager.events.addUserUnloaded(unloaded);
    return () => {
      manager.events.removeUserLoaded(loaded);
      manager.events.removeUserUnloaded(unloaded);
    };
  }, [manager]);

  const signIn = useCallback(async () => {
    if (!manager) throw new Error("Cognito configuration is missing");
    await manager.signinRedirect();
  }, [manager]);

  const signOut = useCallback(async () => {
    if (!manager) return;
    await manager.removeUser();
    window.sessionStorage.clear();
    setUser(null);
    await manager.signoutRedirect();
  }, [manager]);

  return (
    <AuthContext.Provider
      value={{
        user,
        ready,
        configured: manager !== null,
        getAccessToken,
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
