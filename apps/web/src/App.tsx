import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import {
  canAccess,
  defaultPathForRoles,
  roleOrder,
  verifiedRoles,
  type GateSightRole,
} from "./auth/roles";
import { AppShell } from "./components/AppShell";
import { CameraStationPage } from "./pages/CameraStationPage";
import { DataPage } from "./pages/DataPage";
import { FacilitiesPage } from "./pages/FacilitiesPage";
import { SignInPage } from "./pages/SignInPage";
import { SystemPage } from "./pages/SystemPage";

function Protected() {
  const { user, ready } = useAuth();
  if (!ready) return <div className="center-card">Restoring secure session…</div>;
  return user ? <AppShell /> : <Navigate to="/sign-in" replace />;
}

function RoleGuard({
  allowed,
  children,
}: {
  allowed: readonly GateSightRole[];
  children: ReactNode;
}) {
  const { user } = useAuth();
  const roles = verifiedRoles(user?.profile["cognito:groups"]);
  return canAccess(roles, allowed) ? (
    children
  ) : (
    <Navigate to={defaultPathForRoles(roles)} replace />
  );
}

function DefaultRoute() {
  const { user } = useAuth();
  const roles = verifiedRoles(user?.profile["cognito:groups"]);
  return <Navigate to={defaultPathForRoles(roles)} replace />;
}

function AccessRequiredPage() {
  return (
    <div className="page access-required">
      <p className="eyebrow">ACCESS SETUP</p>
      <h1>Your identity is verified, but GateSight access is not configured.</h1>
      <p>
        Ask an administrator to add a GateSight role and at least one facility,
        then sign out and sign in again.
      </p>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/auth/callback" element={<SignInPage />} />
      <Route element={<Protected />}>
        <Route
          path="/station"
          element={
            <RoleGuard allowed={["ADMIN", "OPERATOR"]}>
              <CameraStationPage />
            </RoleGuard>
          }
        />
        <Route
          path="/observations"
          element={
            <RoleGuard allowed={roleOrder}>
              <DataPage key="/observations" path="/observations" />
            </RoleGuard>
          }
        />
        <Route
          path="/visits/open"
          element={
            <RoleGuard allowed={roleOrder}>
              <DataPage key="/visits/open" path="/visits/open" />
            </RoleGuard>
          }
        />
        <Route
          path="/visits"
          element={
            <RoleGuard allowed={roleOrder}>
              <DataPage key="/visits" path="/visits" />
            </RoleGuard>
          }
        />
        <Route
          path="/registrations"
          element={
            <RoleGuard allowed={["ADMIN", "SECURITY"]}>
              <DataPage key="/registrations" path="/registrations" />
            </RoleGuard>
          }
        />
        <Route
          path="/alerts"
          element={
            <RoleGuard allowed={["ADMIN", "SECURITY"]}>
              <DataPage key="/alerts" path="/alerts" />
            </RoleGuard>
          }
        />
        <Route
          path="/facilities"
          element={
            <RoleGuard allowed={["ADMIN"]}>
              <FacilitiesPage />
            </RoleGuard>
          }
        />
        <Route
          path="/system"
          element={
            <RoleGuard allowed={["ADMIN"]}>
              <SystemPage />
            </RoleGuard>
          }
        />
        <Route path="/access-required" element={<AccessRequiredPage />} />
        <Route path="*" element={<DefaultRoute />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
