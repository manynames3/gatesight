import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiClient, type OperationalStatus, type SystemHealth } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { StatusChip } from "../components/StatusChip";

function tone(status: OperationalStatus): "good" | "warn" | "danger" | "neutral" {
  if (status === "healthy") return "good";
  if (status === "attention") return "warn";
  if (status === "critical") return "danger";
  return "neutral";
}

function timestamp(value?: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function HealthCard({
  title,
  status,
  value,
  children,
}: {
  title: string;
  status: OperationalStatus;
  value: string;
  children: ReactNode;
}) {
  return (
    <section className="health-card">
      <div className="card-title-row">
        <p>{title}</p>
        <StatusChip tone={tone(status)}>{status}</StatusChip>
      </div>
      <strong>{value}</strong>
      <div className="health-detail">{children}</div>
    </section>
  );
}

export function SystemPage() {
  const { getApiToken } = useAuth();
  const api = useMemo(
    () => new ApiClient(import.meta.env.VITE_API_ORIGIN, getApiToken),
    [getApiToken],
  );
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setHealth(await api.getSystemHealth());
      setError(null);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const components = health?.components;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">OPERATIONS</p>
          <h1>System health</h1>
          <p>Live, authenticated AWS pipeline state. No plate values are included in telemetry.</p>
        </div>
        <div className="system-actions">
          {health && <StatusChip tone={tone(health.status)}>Overall {health.status}</StatusChip>}
          <button className="secondary-button" type="button" onClick={() => void refresh()} disabled={loading}>
            {loading ? "Checking…" : "Refresh"}
          </button>
        </div>
      </header>
      {error && <div className="error-panel" role="alert">Health check failed: {error}</div>}
      {!components ? (
        <section className="health-loading" aria-live="polite">Reading live AWS health signals…</section>
      ) : (
        <>
          <div className="health-grid">
            <HealthCard title="Control API" status={components.controlApi.status} value="Online">
              <span>{components.controlApi.detail}</span>
              <span>Environment: {health.environment}</span>
            </HealthCard>
            <HealthCard
              title="Recognition worker"
              status={components.recognitionWorker.status}
              value={components.recognitionWorker.state}
            >
              <span>Deployment: {components.recognitionWorker.lastUpdateStatus}</span>
              <span>Updated: {timestamp(components.recognitionWorker.lastModified)}</span>
            </HealthCard>
            <HealthCard
              title="Recognition queue"
              status={components.recognitionQueue.status}
              value={`${components.recognitionQueue.visible} waiting`}
            >
              <span>{components.recognitionQueue.inFlight} in flight</span>
              <span>{components.recognitionQueue.delayed} delayed</span>
            </HealthCard>
            <HealthCard
              title="Transactional outbox"
              status={components.outbox.status}
              value={`${components.outbox.pending} pending`}
            >
              <span>{components.outbox.published} published</span>
              <span>{components.outbox.failed} failed</span>
            </HealthCard>
            <HealthCard
              title="Camera heartbeats"
              status={components.stations.status}
              value={`${components.stations.healthy}/${components.stations.total} reporting`}
            >
              <span>{components.stations.stale} stale</span>
              <span>Fresh within {components.stations.staleAfterSeconds}s</span>
            </HealthCard>
            <HealthCard
              title="Dead-letter queue"
              status={components.deadLetterQueue.status}
              value={`${components.deadLetterQueue.visible} messages`}
            >
              <span>{components.deadLetterQueue.inFlight} being inspected</span>
              <span>{components.deadLetterQueue.delayed} delayed</span>
            </HealthCard>
          </div>

          <section className="station-health">
            <div className="section-heading">
              <div>
                <p className="eyebrow">STATION SIGNALS</p>
                <h2>Camera station heartbeats</h2>
              </div>
              <p>Checked {timestamp(health.checkedAt)}</p>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Station</th><th>Facility</th><th>Last heartbeat</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {components.stations.stations.map((station) => (
                    <tr key={station.stationId}>
                      <td>{station.name}</td>
                      <td>{station.facilityId}</td>
                      <td>{timestamp(station.lastHeartbeatAt)}</td>
                      <td><StatusChip tone={station.status === "healthy" ? "good" : "warn"}>{station.status}</StatusChip></td>
                    </tr>
                  ))}
                  {components.stations.stations.length === 0 && (
                    <tr><td colSpan={4} className="muted">No camera stations are configured for this tenant.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
