import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
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

export default function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/auth/callback" element={<SignInPage />} />
      <Route element={<Protected />}>
        <Route path="/station" element={<CameraStationPage />} />
        <Route path="/observations" element={<DataPage path="/observations" />} />
        <Route path="/visits/open" element={<DataPage path="/visits/open" />} />
        <Route path="/visits" element={<DataPage path="/visits" />} />
        <Route path="/registrations" element={<DataPage path="/registrations" />} />
        <Route path="/alerts" element={<DataPage path="/alerts" />} />
        <Route path="/facilities" element={<FacilitiesPage />} />
        <Route path="/system" element={<SystemPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/station" replace />} />
    </Routes>
  );
}
