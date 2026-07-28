import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";

export function SignInPage() {
  const { user, ready, configured, authError, signIn } = useAuth();
  const [redirectError, setRedirectError] = useState<string | null>(null);
  const [startingSignIn, setStartingSignIn] = useState(false);

  async function startSignIn() {
    setRedirectError(null);
    setStartingSignIn(true);
    try {
      await signIn();
    } catch {
      setRedirectError(
        "Secure sign-in could not be started. Check your connection and try again.",
      );
      setStartingSignIn(false);
    }
  }

  if (!ready) return <div className="center-card">Restoring secure session…</div>;
  if (user) return <Navigate to="/station" replace />;
  const visibleError = redirectError ?? authError;
  return (
    <main className="signin-page">
      <section className="signin-panel">
        <div className="brand signin-brand">
          <span className="brand-mark" aria-hidden="true">
            GS
          </span>
          <div>
            <strong>GateSight</strong>
            <small>Vehicle gate operations</small>
          </div>
        </div>
        <p className="eyebrow">AUTHORIZED FACILITY ACCESS</p>
        <h1>Keep vehicle flow moving without sacrificing review.</h1>
        <p>
          Capture at the gate first. Recognition runs asynchronously and uncertain plates are
          routed to a person—never treated as unregistered evidence.
        </p>
        <button
          type="button"
          className="primary-button"
          disabled={!configured || startingSignIn}
          onClick={() => void startSignIn()}
        >
          {startingSignIn ? "Opening secure sign in…" : "Continue with secure sign in"}
        </button>
        {visibleError && (
          <p className="error-panel" role="alert">
            {visibleError}
          </p>
        )}
        {!configured && (
          <p className="error-panel" role="alert">
            Cognito configuration is missing. Configure the public OAuth client environment
            variables before sign in.
          </p>
        )}
        <p className="fine-print">
          GateSight is an independent portfolio project and is not affiliated with or endorsed
          by Cox Automotive, Manheim, or any other vehicle marketplace.
        </p>
      </section>
      <aside className="signin-visual" aria-label="Operational principles">
        <div className="lane-grid" />
        <div className="visual-copy">
          <span>CAPTURE</span>
          <span>QUEUE</span>
          <span>RECOGNIZE</span>
          <span>REVIEW</span>
        </div>
      </aside>
    </main>
  );
}
