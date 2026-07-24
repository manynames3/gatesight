import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { ApiClient } from "../api/client";
import type { Facility, Station } from "../api/generated";

export function FacilitiesPage() {
  const { getApiToken } = useAuth();
  const api = useMemo(
    () => new ApiClient(import.meta.env.VITE_API_ORIGIN, getApiToken),
    [getApiToken],
  );
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [stations, setStations] = useState<Record<string, Station[]>>({});

  useEffect(() => {
    api.getFacilities().then(async (page) => {
      setFacilities(page.items);
      const entries = await Promise.all(
        page.items.map(async (facility) => [
          facility.recordId,
          (await api.getStations(facility.recordId)).items,
        ] as const),
      );
      setStations(Object.fromEntries(entries));
    }).catch(() => setFacilities([]));
  }, [api]);

  return (
    <div className="page">
      <header className="page-header">
        <div><p className="eyebrow">ADMINISTRATION</p><h1>Facilities & camera stations</h1><p>Logical gates are explicit entry or exit lanes; physical cameras are selected at the station.</p></div>
      </header>
      <div className="card-grid">
        {facilities.map((facility) => (
          <section className="control-card" key={facility.recordId}>
            <p className="eyebrow">{facility.timezone}</p>
            <h2>{facility.name}</h2>
            {(stations[facility.recordId] ?? []).map((station) => (
              <div className="station-row" key={station.recordId}>
                <div><strong>{station.name}</strong><small>{station.recordId}</small></div>
                <span>{station.direction}</span>
              </div>
            ))}
            {(stations[facility.recordId] ?? []).length === 0 && <p className="muted">No camera stations configured.</p>}
          </section>
        ))}
      </div>
    </div>
  );
}
