import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiClient, ApiError, type OperationalStatus, type SystemHealth } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { StatusChip } from "../components/StatusChip";

function tone(status: OperationalStatus): "good" | "warn" | "danger" | "neutral" {
  if (status === "healthy") return "good";
  if (status === "attention") return "warn";
  if (status === "critical") return "danger";
  return "neutral";
}

function humanWords(value: string): string {
  return value
    .replaceAll("_", " ")
    .trim()
    .toLocaleLowerCase()
    .replace(/\b\w/g, (letter) => letter.toLocaleUpperCase());
}

function timestamp(value?: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function facilityName(facilityId: string): string {
  return humanWords(facilityId.replace(/^fac_/, ""));
}

function loadError(caught: unknown): string {
  if (caught instanceof ApiError && (caught.status === 401 || caught.status === 403)) {
    return "System health is not available to this account.";
  }
  if (caught instanceof Error && /fetch|network|offline/i.test(caught.message)) {
    return "System health could not be reached. Check your connection and try again.";
  }
  return "System health could not be loaded. Try again in a moment.";
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
        <StatusChip tone={tone(status)}>{humanWords(status)}</StatusChip>
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
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const inFlight = useRef(false);
  const hasHealth = useRef(false);

  const refresh = useCallback(
    async (mode: "initial" | "background" = "background") => {
      if (inFlight.current) return;
      inFlight.current = true;
      const requestId = ++request.current;
      const effectiveMode = mode === "initial" || !hasHealth.current
        ? "initial"
        : "background";
      if (effectiveMode === "initial") setInitialLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const nextHealth = await api.getSystemHealth();
        if (requestId !== request.current) return;
        hasHealth.current = true;
        setHealth(nextHealth);
      } catch (caught: unknown) {
        if (requestId !== request.current) return;
        setError(loadError(caught));
      } finally {
        if (requestId === request.current) {
          setInitialLoading(false);
          setRefreshing(false);
        }
        inFlight.current = false;
      }
    },
    [api],
  );

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const poll = async (mode: "initial" | "background") => {
      await refresh(mode);
      if (!cancelled) {
        timer = window.setTimeout(() => void poll("background"), 15_000);
      }
    };
    timer = window.setTimeout(() => void poll("initial"), 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      request.current += 1;
    };
  }, [refresh]);

  const components = health?.components;
  const busy = initialLoading || refreshing;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">OPERATIONS</p>
          <h1>System health</h1>
          <p>Live AWS service, processing, queue, and camera-station status.</p>
        </div>
        <div className="system-actions">
          {health && (
            <StatusChip tone={tone(health.status)}>Overall {humanWords(health.status)}</StatusChip>
          )}
          <button
            className="secondary-button"
            type="button"
            onClick={() => void refresh(health ? "background" : "initial")}
            disabled={busy}
          >
            {busy ? "Checking…" : "Refresh"}
          </button>
        </div>
      </header>

      {error && health && (
        <div className="error-panel actionable-error" role="alert">
          <span>{error} Showing the last successful health check.</span>
          <button className="secondary-button" type="button" onClick={() => void refresh("background")}>
            Try again
          </button>
        </div>
      )}

      {initialLoading && !components ? (
        <section className="health-loading" aria-live="polite">Reading live AWS health signals…</section>
      ) : error && !components ? (
        <section className="empty-state system-error-state" role="alert">
          <span aria-hidden="true">!</span>
          <h2>System health is unavailable</h2>
          <p>{error}</p>
          <button className="secondary-button" type="button" onClick={() => void refresh("initial")}>
            Try again
          </button>
        </section>
      ) : components && health ? (
        <>
          <div className="health-summary" aria-live="polite">
            <span>{refreshing ? "Refreshing health signals…" : `Checked ${timestamp(health.checkedAt)}`}</span>
          </div>
          <div className="health-grid">
            <HealthCard
              title="Control API"
              status={components.controlApi.status}
              value={components.controlApi.status === "healthy" ? "Online" : "Needs attention"}
            >
              <span>{components.controlApi.detail}</span>
              <span>Environment: {humanWords(health.environment)}</span>
            </HealthCard>
            <HealthCard
              title="Recognition worker"
              status={components.recognitionWorker.status}
              value={humanWords(components.recognitionWorker.state)}
            >
              <span>Deployment: {humanWords(components.recognitionWorker.lastUpdateStatus)}</span>
              <span>Last updated: {timestamp(components.recognitionWorker.lastModified)}</span>
            </HealthCard>
            <HealthCard
              title="Recognition queue"
              status={components.recognitionQueue.status}
              value={components.recognitionQueue.configured
                ? `${components.recognitionQueue.visible.toLocaleString()} waiting`
                : "Not configured"}
            >
              <span>{components.recognitionQueue.inFlight.toLocaleString()} being processed</span>
              <span>{components.recognitionQueue.delayed.toLocaleString()} delayed</span>
            </HealthCard>
            <HealthCard
              title="Transactional outbox"
              status={components.outbox.status}
              value={`${components.outbox.pending.toLocaleString()} pending`}
            >
              <span>{components.outbox.published.toLocaleString()} published</span>
              <span>{components.outbox.failed.toLocaleString()} failed</span>
            </HealthCard>
            <HealthCard
              title="Camera heartbeats"
              status={components.stations.status}
              value={`${components.stations.healthy.toLocaleString()}/${components.stations.total.toLocaleString()} reporting`}
            >
              <span>{components.stations.stale.toLocaleString()} stale</span>
              <span>{components.stations.uncommissioned.toLocaleString()} not commissioned</span>
              <span>Expected every {components.stations.staleAfterSeconds.toLocaleString()} seconds</span>
            </HealthCard>
            <HealthCard
              title="Dead-letter queue"
              status={components.deadLetterQueue.status}
              value={components.deadLetterQueue.configured
                ? `${components.deadLetterQueue.visible.toLocaleString()} messages`
                : "Not configured"}
            >
              <span>{components.deadLetterQueue.inFlight.toLocaleString()} being inspected</span>
              <span>{components.deadLetterQueue.delayed.toLocaleString()} delayed</span>
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
                <caption className="sr-only">Camera station heartbeat status</caption>
                <thead>
                  <tr>
                    <th scope="col">Station</th>
                    <th scope="col">Facility</th>
                    <th scope="col">Last heartbeat</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {components.stations.stations.map((station) => (
                    <tr key={station.stationId}>
                      <td>{station.name}</td>
                      <td>{facilityName(station.facilityId)}</td>
                      <td>{timestamp(station.lastHeartbeatAt)}</td>
                      <td>
                        <StatusChip tone={station.status === "healthy" ? "good" : station.status === "stale" ? "warn" : "neutral"}>
                          {humanWords(station.status)}
                        </StatusChip>
                      </td>
                    </tr>
                  ))}
                  {components.stations.stations.length === 0 && (
                    <tr>
                      <td colSpan={4} className="muted">
                        No camera stations are configured for this tenant.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
