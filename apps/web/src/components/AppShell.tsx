import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import {
  roleOrder,
  verifiedRoles,
  type GateSightRole,
} from "../auth/roles";

interface NavigationItem {
  href: string;
  label: string;
  roles: readonly GateSightRole[];
}

const navigation: readonly NavigationItem[] = [
  { href: "/station", label: "Camera station", roles: ["ADMIN", "OPERATOR"] },
  { href: "/observations", label: "Observations", roles: roleOrder },
  { href: "/visits/open", label: "Open visits", roles: roleOrder },
  { href: "/visits", label: "Visit history", roles: roleOrder },
  {
    href: "/registrations",
    label: "Registered vehicles",
    roles: ["ADMIN", "SECURITY"],
  },
  { href: "/alerts", label: "Security alerts", roles: ["ADMIN", "SECURITY"] },
  { href: "/facilities", label: "Facilities & stations", roles: ["ADMIN"] },
  { href: "/system", label: "System health", roles: ["ADMIN"] },
];

function roleLabel(role: GateSightRole | undefined): string {
  if (!role) return "No GateSight role";
  return `${role[0]}${role.slice(1).toLowerCase()} role`;
}

export function AppShell() {
  const { user, signOut } = useAuth();
  const roles = verifiedRoles(user?.profile["cognito:groups"]);
  const primaryRole = roles[0];
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
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
          {navigation
            .filter(({ roles: allowedRoles }) =>
              roles.some((role) => allowedRoles.includes(role)),
            )
            .map(({ href, label }) => (
              <NavLink key={href} to={href} end>
                {label}
              </NavLink>
            ))}
        </nav>
        <div className="sidebar-account">
          <div>
            <strong>{user?.profile.email ?? user?.profile.sub ?? "Signed-in user"}</strong>
            <small>{roleLabel(primaryRole)}</small>
          </div>
          <button type="button" className="text-button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main" id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
