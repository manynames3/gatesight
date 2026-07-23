import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { ApiClient } from "../api/client";
import type { Facility } from "../api/generated";

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return value.toString();
  return JSON.stringify(value);
}

const pageConfiguration = {
  "/observations": {
    eyebrow: "RECOGNITION",
    title: "Observations",
    description: "Review model outcomes and preserve the evidence behind every decision.",
  },
  "/visits/open": {
    eyebrow: "YARD ACTIVITY",
    title: "Open visits",
    description: "Vehicles with a recognized entry and no compatible exit.",
  },
  "/visits": {
    eyebrow: "YARD HISTORY",
    title: "Visit history",
    description: "Entry/exit pairing, dwell duration, and operational anomalies.",
  },
  "/registrations": {
    eyebrow: "AUTHORIZATION",
    title: "Registered vehicles",
    description: "Facility and tenant-wide allowlist records, including blocked vehicles.",
  },
  "/alerts": {
    eyebrow: "SECURITY",
    title: "Security alerts",
    description: "High-confidence unregistered entries and blocked-vehicle matches.",
  },
} as const;

export function DataPage({ path }: { path: keyof typeof pageConfiguration }) {
  const { user } = useAuth();
  const api = useMemo(
    () => new ApiClient(import.meta.env.VITE_API_ORIGIN, () => user?.access_token),
    [user],
  );
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityId, setFacilityId] = useState("");
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);
  const config = pageConfiguration[path];

  useEffect(() => {
    api
      .getFacilities()
      .then((page) => {
        setFacilities(page.items);
        setFacilityId(page.items[0]?.recordId ?? "");
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, [api]);

  useEffect(() => {
    if (!facilityId) return;
    api
      .getPage<Record<string, unknown>>(path, facilityId)
      .then((page) => setItems(page.items))
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, [api, facilityId, path]);

  const preferredFields = [
    "occurredAt",
    "capturedAt",
    "entryAt",
    "exitAt",
    "state",
    "status",
    "direction",
    "maskedPlate",
    "displayPlate",
    "description",
    "dwellSeconds",
    "reason",
    "recordId",
  ];
  const fields = preferredFields.filter((field) => items.some((item) => field in item)).slice(0, 7);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{config.eyebrow}</p>
          <h1>{config.title}</h1>
          <p>{config.description}</p>
        </div>
        <label className="compact-select">
          Facility
          <select value={facilityId} onChange={(event) => setFacilityId(event.target.value)}>
            {facilities.map((facility) => <option key={facility.recordId} value={facility.recordId}>{facility.name}</option>)}
          </select>
        </label>
      </header>
      {error && <div className="error-panel" role="alert">{error}</div>}
      {items.length === 0 ? (
        <section className="empty-state">
          <span aria-hidden="true">◇</span>
          <h2>No records for this facility</h2>
          <p>New operational records appear here after real gate activity. GateSight does not seed production data.</p>
        </section>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr>{fields.map((field) => <th key={field}>{field.replace(/([A-Z])/g, " $1")}</th>)}</tr></thead>
            <tbody>
              {items.map((item, row) => (
                <tr key={typeof item.recordId === "string" ? item.recordId : String(row)}>
                  {fields.map((field) => <td key={field}>{displayValue(item[field])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
