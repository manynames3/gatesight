import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";

const navigation = [
  ["/station", "Camera station"],
  ["/observations", "Observations"],
  ["/visits/open", "Open visits"],
  ["/visits", "Visit history"],
  ["/registrations", "Registered vehicles"],
  ["/alerts", "Security alerts"],
  ["/facilities", "Facilities & stations"],
  ["/system", "System health"],
] as const;

export function AppShell() {
  const { user, signOut } = useAuth();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            GS
          </span>
          <div>
            <strong>GateSight</strong>
            <small>Vehicle gate operations</small>
          </div>
        </div>
        <nav aria-label="Primary">
          {navigation.map(([href, label]) => (
            <NavLink key={href} to={href} end={href !== "/visits"}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-account">
          <span>{user?.profile.email ?? user?.profile.sub}</span>
          <button type="button" className="text-button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
