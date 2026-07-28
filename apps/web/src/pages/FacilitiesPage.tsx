import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiClient, ApiError } from "../api/client";
import type { Facility, Station } from "../api/generated";
import { useAuth } from "../auth/AuthProvider";

type StationState = {
  items: Station[];
  loading: boolean;
  error: string | null;
  updatedAt: Date | undefined;
};

function loadError(caught: unknown, subject: string): string {
  if (caught instanceof ApiError && (caught.status === 401 || caught.status === 403)) {
    return `${subject} could not be loaded because this account does not have access.`;
  }
  if (caught instanceof Error && /fetch|network|offline/i.test(caught.message)) {
    return `${subject} could not be loaded. Check your connection and try again.`;
  }
  return `${subject} could not be loaded. Try again in a moment.`;
}

function humanDirection(direction: Station["direction"]): string {
  return direction === "ENTRY" ? "Entry lane" : "Exit lane";
}

function timestamp(value?: string): string {
  if (!value) return "No heartbeat received";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Heartbeat received"
    : `Last heartbeat ${date.toLocaleString()}`;
}

function stationSummary(station: Station): string {
  if (station.commissioned === false) return "Not commissioned";
  if (station.armed === false) return "Automatic capture is off";
  return timestamp(station.lastHeartbeatAt);
}

export function FacilitiesPage() {
  const { getApiToken } = useAuth();
  const api = useMemo(
    () => new ApiClient(import.meta.env.VITE_API_ORIGIN, getApiToken),
    [getApiToken],
  );
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [stations, setStations] = useState<Record<string, StationState>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const facilitiesRequest = useRef(0);
  const stationRequests = useRef<Record<string, number>>({});

  const refreshStations = useCallback(
    async (facilityId: string) => {
      const requestId = (stationRequests.current[facilityId] ?? 0) + 1;
      stationRequests.current[facilityId] = requestId;
      setStations((current) => ({
        ...current,
        [facilityId]: {
          items: current[facilityId]?.items ?? [],
          loading: true,
          error: null,
          updatedAt: current[facilityId]?.updatedAt,
        },
      }));
      try {
        const page = await api.getStations(facilityId);
        if (stationRequests.current[facilityId] !== requestId) return;
        setStations((current) => ({
          ...current,
          [facilityId]: {
            items: page.items,
            loading: false,
            error: null,
            updatedAt: new Date(),
          },
        }));
      } catch (caught: unknown) {
        if (stationRequests.current[facilityId] !== requestId) return;
        setStations((current) => ({
          ...current,
          [facilityId]: {
            items: current[facilityId]?.items ?? [],
            loading: false,
            error: loadError(caught, "Camera stations"),
            updatedAt: current[facilityId]?.updatedAt,
          },
        }));
      }
    },
    [api],
  );

  const refresh = useCallback(async () => {
    const requestId = ++facilitiesRequest.current;
    setLoading(true);
    setError(null);
    try {
      const page = await api.getFacilities();
      if (requestId !== facilitiesRequest.current) return;
      const facilityIds = new Set(page.items.map((facility) => facility.recordId));
      setFacilities(page.items);
      setStations((current) => Object.fromEntries(
        Object.entries(current).filter(([facilityId]) => facilityIds.has(facilityId)),
      ));

      const requests = page.items.map((facility) => {
        const stationRequestId = (stationRequests.current[facility.recordId] ?? 0) + 1;
        stationRequests.current[facility.recordId] = stationRequestId;
        return { facility, stationRequestId };
      });
      setStations((current) => {
        const next = { ...current };
        for (const { facility } of requests) {
          next[facility.recordId] = {
            items: current[facility.recordId]?.items ?? [],
            loading: true,
            error: null,
            updatedAt: current[facility.recordId]?.updatedAt,
          };
        }
        return next;
      });

      const results = await Promise.allSettled(
        requests.map(({ facility }) => api.getStations(facility.recordId)),
      );
      if (requestId !== facilitiesRequest.current) return;
      setStations((current) => {
        const next = { ...current };
        results.forEach((result, index) => {
          const requestDetails = requests[index];
          if (!requestDetails) return;
          const { facility, stationRequestId } = requestDetails;
          if (stationRequests.current[facility.recordId] !== stationRequestId) return;
          if (result.status === "fulfilled") {
            next[facility.recordId] = {
              items: result.value.items,
              loading: false,
              error: null,
              updatedAt: new Date(),
            };
          } else {
            next[facility.recordId] = {
              items: current[facility.recordId]?.items ?? [],
              loading: false,
              error: loadError(result.reason, "Camera stations"),
              updatedAt: current[facility.recordId]?.updatedAt,
            };
          }
        });
        return next;
      });
    } catch (caught: unknown) {
      if (requestId !== facilitiesRequest.current) return;
      setError(loadError(caught, "Facilities"));
    } finally {
      if (requestId === facilitiesRequest.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    const stationRequestState = stationRequests.current;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => {
      window.clearTimeout(timer);
      facilitiesRequest.current += 1;
      for (const facilityId of Object.keys(stationRequestState)) {
        stationRequestState[facilityId] = (stationRequestState[facilityId] ?? 0) + 1;
      }
    };
  }, [refresh]);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">ADMINISTRATION</p>
          <h1>Facilities & camera stations</h1>
          <p>See where each entry and exit camera is assigned and whether it is ready to report.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void refresh()} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {error && (
        <div className="error-panel actionable-error" role="alert">
          <span>
            {error}
            {facilities.length > 0 && " Showing the most recent successful facility list."}
          </span>
          <button className="secondary-button" type="button" onClick={() => void refresh()}>
            Try again
          </button>
        </div>
      )}

      {loading && facilities.length === 0 ? (
        <section className="health-loading" aria-live="polite">Loading facilities and camera stations…</section>
      ) : error && facilities.length === 0 ? null : facilities.length === 0 ? (
        <section className="empty-state">
          <span aria-hidden="true">◇</span>
          <h2>No facilities configured</h2>
          <p>Create a facility and assign an entry or exit camera station to begin.</p>
          <button className="secondary-button" type="button" onClick={() => void refresh()}>
            Check again
          </button>
        </section>
      ) : (
        <div className="card-grid">
          {facilities.map((facility) => {
            const stationState = stations[facility.recordId];
            const stationItems = stationState?.items ?? [];
            return (
              <section className="control-card" key={facility.recordId}>
                <p className="eyebrow">
                  {facility.timezone.replaceAll("_", " ")}
                </p>
                <h2>{facility.name}</h2>

                {stationState?.error && (
                  <div className="station-error" role="alert">
                    <p>
                      {stationState.error}
                      {stationItems.length > 0 && " Showing the last successful station list."}
                    </p>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void refreshStations(facility.recordId)}
                      disabled={stationState.loading}
                    >
                      Retry stations
                    </button>
                  </div>
                )}

                {stationItems.map((station) => (
                  <div className="station-row" key={station.recordId}>
                    <div>
                      <strong>{station.name}</strong>
                      <small>{stationSummary(station)}</small>
                    </div>
                    <span>{humanDirection(station.direction)}</span>
                  </div>
                ))}

                {stationState?.loading && stationItems.length === 0 && (
                  <p className="muted" aria-live="polite">Loading camera stations…</p>
                )}
                {!stationState?.loading && !stationState?.error && stationItems.length === 0 && (
                  <p className="muted">No camera stations are configured for this facility.</p>
                )}
                {stationState?.loading && stationItems.length > 0 && (
                  <p className="muted" aria-live="polite">Refreshing camera stations…</p>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
