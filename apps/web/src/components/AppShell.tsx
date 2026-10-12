import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import {
  roleOrder,
  verifiedRoles,
  type GateSightRole,
} from "../auth/roles";
import { Brand } from "./Brand";

interface NavigationItem {
  href: string;
  label: string;
  icon: "camera" | "scan" | "entry" | "history" | "vehicle" | "alert" | "facility" | "health";
  roles: readonly GateSightRole[];
}

const navigation: readonly NavigationItem[] = [
  { href: "/station", label: "Camera station", icon: "camera", roles: ["ADMIN", "OPERATOR"] },
  { href: "/observations", label: "Observations", icon: "scan", roles: roleOrder },
  { href: "/visits/open", label: "Open visits", icon: "entry", roles: roleOrder },
  { href: "/visits", label: "Visit history", icon: "history", roles: roleOrder },
  {
    href: "/registrations",
    label: "Registered vehicles",
    icon: "vehicle",
    roles: ["ADMIN", "SECURITY"],
  },
  { href: "/alerts", label: "Security alerts", icon: "alert", roles: ["ADMIN", "SECURITY"] },
  { href: "/facilities", label: "Facilities & stations", icon: "facility", roles: ["ADMIN"] },
  { href: "/system", label: "System health", icon: "health", roles: ["ADMIN"] },
];

function NavIcon({ name }: { name: NavigationItem["icon"] }) {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
      {name === "camera" && <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="m8 6 1.5-2h5L16 6" /><circle cx="12" cy="12.5" r="3.5" /></>}
      {name === "scan" && <><path d="M8 4H4v4M16 4h4v4M20 16v4h-4M8 20H4v-4" /><rect x="7" y="9" width="10" height="6" rx="1.5" /></>}
      {name === "entry" && <><path d="M5 20V4h11v16M9 12h11M17 9l3 3-3 3" /></>}
      {name === "history" && <><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8" /><path d="M4 4v4h4M12 7v5l3 2" /></>}
      {name === "vehicle" && <><path d="m5 10 2-4h10l2 4M4 10h16v7H4z" /><circle cx="7" cy="17" r="1.5" /><circle cx="17" cy="17" r="1.5" /></>}
      {name === "alert" && <><path d="M12 3 2.8 20h18.4z" /><path d="M12 9v4M12 17h.01" /></>}
      {name === "facility" && <><path d="M4 21V8l8-5 8 5v13M9 21v-7h6v7" /></>}
      {name === "health" && <><path d="M3 12h4l2-5 4 10 2-5h6" /></>}
    </svg>
  );
}

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
        <Brand />
        <nav aria-label="Primary">
          {navigation
            .filter(({ roles: allowedRoles }) =>
              roles.some((role) => allowedRoles.includes(role)),
            )
            .map(({ href, label, icon }) => (
              <NavLink key={href} to={href} end>
                <NavIcon name={icon} />
                {label}
              </NavLink>
            ))}
        </nav>
        <div className="sidebar-account">
          <span className="account-avatar" aria-hidden="true">
            {(user?.profile.email ?? user?.profile.sub ?? "U").charAt(0).toUpperCase()}
          </span>
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
