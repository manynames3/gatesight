import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiClient, ApiError } from "../api/client";
import type { Facility } from "../api/generated";
import { useAuth } from "../auth/AuthProvider";
import { canAccess, verifiedRoles } from "../auth/roles";
import {
  OperationalRecordPanel,
  RegistrationCreatePanel,
} from "./OperationalRecordPanel";

const DATE_FIELDS = new Set(["occurredAt", "capturedAt", "entryAt", "exitAt", "createdAt"]);
const PREFERRED_FIELDS = [
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
const EMPTY_ITEMS: Array<Record<string, unknown>> = [];

function humanWords(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase()
    .replace(/\b\w/g, (letter) => letter.toLocaleUpperCase());
}

function fieldHeading(field: string): string {
  const labels: Record<string, string> = {
    capturedAt: "Captured",
    description: "Description",
    direction: "Direction",
    displayPlate: "Vehicle",
    dwellSeconds: "Dwell time",
    entryAt: "Entered",
    exitAt: "Exited",
    maskedPlate: "Vehicle",
    occurredAt: "Occurred",
    reason: "Reason",
    recordId: "Record ID",
    state: "Outcome",
    status: "Status",
  };
  return labels[field] ?? humanWords(field.replace(/([a-z])([A-Z])/g, "$1 $2"));
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  if (minutes < 60) return remainder ? `${minutes} min ${remainder} sec` : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours} hr ${remainingMinutes} min` : `${hours} hr`;
}

function displayValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (value === "NO_PLATE") return "Not detected — review";
  if (field === "dwellSeconds" && typeof value === "number") return formatDuration(value);
  if (typeof value === "string") {
    if (DATE_FIELDS.has(field) || field.endsWith("At")) return formatDate(value);
    if (field === "state" || field === "status" || field === "direction" || field === "reason") {
      return humanWords(value);
    }
    return value;
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString();
  if (Array.isArray(value)) return value.map(String).join(", ");
  return "Details available";
}

function loadError(caught: unknown, subject: string): string {
  if (caught instanceof ApiError && (caught.status === 401 || caught.status === 403)) {
    return `${subject} could not be loaded because this account does not have access.`;
  }
  if (caught instanceof Error && /fetch|network|offline/i.test(caught.message)) {
    return `${subject} could not be loaded. Check your connection and try again.`;
  }
  return `${subject} could not be loaded. Try again in a moment.`;
}

const pageConfiguration = {
  "/observations": {
    eyebrow: "RECOGNITION",
    title: "Observations",
    description: "Review recognition outcomes and the evidence behind each decision.",
    emptyTitle: "No observations yet",
    emptyDescription: "Recognized gate activity for this facility will appear here.",
  },
  "/visits/open": {
    eyebrow: "YARD ACTIVITY",
    title: "Open visits",
    description: "See vehicles that entered and have not yet recorded a matching exit.",
    emptyTitle: "No vehicles currently inside",
    emptyDescription: "Open visits will appear after a recognized vehicle enters this facility.",
  },
  "/visits": {
    eyebrow: "YARD HISTORY",
    title: "Visit history",
    description: "Review completed visits, dwell time, and operational exceptions.",
    emptyTitle: "No completed visits yet",
    emptyDescription: "Completed entry and exit pairs for this facility will appear here.",
  },
  "/registrations": {
    eyebrow: "AUTHORIZATION",
    title: "Registered vehicles",
    description: "Review vehicles that are allowed or blocked at this facility.",
    emptyTitle: "No registered vehicles",
    emptyDescription: "There are no vehicle registrations for this facility.",
  },
  "/alerts": {
    eyebrow: "SECURITY",
    title: "Security alerts",
    description: "Review unregistered entries and blocked-vehicle matches that need attention.",
    emptyTitle: "No security alerts",
    emptyDescription: "New alerts for this facility will appear here when review is needed.",
  },
} as const;

type PagePath = keyof typeof pageConfiguration;
type DataSet = {
  scope: string;
  items: Array<Record<string, unknown>>;
  nextCursor: string | null;
  updatedAt: Date;
};

export function DataPage({ path }: { path: PagePath }) {
  const { getApiToken, user } = useAuth();
  const api = useMemo(
    () => new ApiClient(import.meta.env.VITE_API_ORIGIN, getApiToken),
    [getApiToken],
  );
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityId, setFacilityId] = useState("");
  const [facilitiesLoading, setFacilitiesLoading] = useState(true);
  const [facilitiesError, setFacilitiesError] = useState<string | null>(null);
  const [data, setData] = useState<DataSet | null>(null);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsRefreshing, setItemsRefreshing] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [itemsAttemptedScope, setItemsAttemptedScope] = useState("");
  const [paginatedScope, setPaginatedScope] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<Record<string, unknown> | null>(
    null,
  );
  const [creatingRegistration, setCreatingRegistration] = useState(false);
  const facilitiesRequest = useRef(0);
  const itemsRequest = useRef(0);
  const openedDeepLink = useRef<string | null>(null);
  const config = pageConfiguration[path];
  const deepLink = useMemo(() => {
    if (path !== "/observations") return { facilityId: "", recordId: "" };
    const query = new URLSearchParams(window.location.search);
    return {
      facilityId: query.get("facility") ?? "",
      recordId: query.get("record") ?? "",
    };
  }, [path]);
  const scope = facilityId ? `${path}:${facilityId}` : "";
  const currentData = data?.scope === scope ? data : null;
  const items = currentData?.items ?? EMPTY_ITEMS;
  const canViewFullPlate = canAccess(
    verifiedRoles(user?.profile["cognito:groups"]),
    ["ADMIN", "SECURITY"],
  );

  const refreshFacilities = useCallback(async () => {
    const requestId = ++facilitiesRequest.current;
    setFacilitiesLoading(true);
    setFacilitiesError(null);
    try {
      const page = await api.getFacilities();
      if (requestId !== facilitiesRequest.current) return;
      setFacilities(page.items);
      setFacilityId((selected) => {
        if (
          deepLink.facilityId &&
          page.items.some((facility) => facility.recordId === deepLink.facilityId)
        ) {
          return deepLink.facilityId;
        }
        if (page.items.some((facility) => facility.recordId === selected)) return selected;
        return page.items[0]?.recordId ?? "";
      });
    } catch (caught: unknown) {
      if (requestId !== facilitiesRequest.current) return;
      setFacilitiesError(loadError(caught, "Facilities"));
    } finally {
      if (requestId === facilitiesRequest.current) setFacilitiesLoading(false);
    }
  }, [api, deepLink.facilityId]);

  const refreshItems = useCallback(
    async (background = false) => {
      if (!facilityId) return;
      const requestScope = `${path}:${facilityId}`;
      const requestId = ++itemsRequest.current;
      setItemsAttemptedScope(requestScope);
      if (background) setItemsRefreshing(true);
      else setItemsLoading(true);
      setItemsError(null);
      try {
        const page = await api.getPage<Record<string, unknown>>(path, facilityId);
        if (requestId !== itemsRequest.current) return;
        setData({
          scope: requestScope,
          items: page.items,
          nextCursor: page.nextCursor,
          updatedAt: new Date(),
        });
        setPaginatedScope(null);
      } catch (caught: unknown) {
        if (requestId !== itemsRequest.current) return;
        const prefix = background
          ? `The latest ${config.title.toLocaleLowerCase()}`
          : config.title;
        setItemsError(loadError(caught, prefix));
      } finally {
        if (requestId === itemsRequest.current) {
          setItemsLoading(false);
          setItemsRefreshing(false);
        }
      }
    },
    [api, config.title, facilityId, path],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshFacilities(), 0);
    return () => {
      window.clearTimeout(timer);
      facilitiesRequest.current += 1;
    };
  }, [refreshFacilities]);

  useEffect(() => {
    if (!facilityId) {
      itemsRequest.current += 1;
      return;
    }
    const timer = window.setTimeout(() => void refreshItems(false), 0);
    return () => {
      window.clearTimeout(timer);
      itemsRequest.current += 1;
    };
  }, [facilityId, path, refreshItems]);

  const loadMore = useCallback(async () => {
    if (!currentData?.nextCursor || !facilityId) return;
    const requestId = ++itemsRequest.current;
    setItemsRefreshing(true);
    setItemsError(null);
    try {
      const page = await api.getPage<Record<string, unknown>>(
        path,
        facilityId,
        currentData.nextCursor,
      );
      if (requestId !== itemsRequest.current) return;
      setData((existing) => {
        if (!existing || existing.scope !== scope) return existing;
        const seen = new Set(
          existing.items
            .map((item) => item.recordId)
            .filter((value): value is string => typeof value === "string"),
        );
        const additions = page.items.filter(
          (item) => typeof item.recordId !== "string" || !seen.has(item.recordId),
        );
        return {
          ...existing,
          items: [...existing.items, ...additions],
          nextCursor: page.nextCursor,
          updatedAt: new Date(),
        };
      });
      setPaginatedScope(scope);
    } catch (caught) {
      if (requestId !== itemsRequest.current) return;
      setItemsError(loadError(caught, `More ${config.title.toLocaleLowerCase()}`));
    } finally {
      if (requestId === itemsRequest.current) setItemsRefreshing(false);
    }
  }, [api, config.title, currentData, facilityId, path, scope]);

  useEffect(() => {
    if (
      !facilityId ||
      (path !== "/observations" && path !== "/visits/open") ||
      paginatedScope === scope
    ) {
      return;
    }
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      await refreshItems(true);
      if (!cancelled) timer = window.setTimeout(() => void poll(), 15_000);
    };
    timer = window.setTimeout(() => void poll(), 15_000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [facilityId, paginatedScope, path, refreshItems, scope]);

  useEffect(() => {
    if (
      path !== "/observations" ||
      !deepLink.recordId ||
      !facilityId ||
      (deepLink.facilityId && deepLink.facilityId !== facilityId)
    ) {
      return;
    }
    const key = `${facilityId}:${deepLink.recordId}`;
    if (openedDeepLink.current === key) return;
    openedDeepLink.current = key;
    setSelectedRecord({ recordId: deepLink.recordId });
  }, [deepLink.facilityId, deepLink.recordId, facilityId, path]);

  const fields = useMemo(() => {
    const preferred = PREFERRED_FIELDS.filter((field) => items.some((item) => field in item));
    if (preferred.length > 0) return preferred.slice(0, 7);
    return [...new Set(items.flatMap(Object.keys))]
      .filter(
        (field) =>
          field !== "tenantId" &&
          field !== "facilityId" &&
          (canViewFullPlate || field !== "normalizedPlate"),
      )
      .slice(0, 7);
  }, [canViewFullPlate, items]);
  const initialDataLoading =
    Boolean(facilityId) &&
    !currentData &&
    (itemsLoading || itemsAttemptedScope !== scope);
  const initialDataFailed =
    Boolean(facilityId) &&
    !currentData &&
    !itemsLoading &&
    itemsAttemptedScope === scope &&
    Boolean(itemsError);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{config.eyebrow}</p>
          <h1>{config.title}</h1>
          <p>{config.description}</p>
        </div>
        <div className="page-actions">
          {path === "/registrations" && facilityId && (
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                setSelectedRecord(null);
                setCreatingRegistration(true);
              }}
            >
              Register vehicle
            </button>
          )}
          <label className="compact-select">
            Facility
            <select
              aria-label="Facility"
              value={facilityId}
              disabled={facilitiesLoading && facilities.length === 0}
              onChange={(event) => {
                setSelectedRecord(null);
                setCreatingRegistration(false);
                setFacilityId(event.target.value);
              }}
            >
              {facilities.length === 0 && (
                <option value="">{facilitiesLoading ? "Loading facilities…" : "No facilities available"}</option>
              )}
              {facilities.map((facility) => (
                <option key={facility.recordId} value={facility.recordId}>{facility.name}</option>
              ))}
            </select>
          </label>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void (facilityId ? refreshItems(Boolean(currentData)) : refreshFacilities())}
            disabled={facilitiesLoading || itemsLoading || itemsRefreshing}
          >
            {itemsLoading || itemsRefreshing || facilitiesLoading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {facilitiesError && (
        <div className="error-panel actionable-error" role="alert">
          <span>{facilitiesError}</span>
          <button className="secondary-button" type="button" onClick={() => void refreshFacilities()}>
            Retry facilities
          </button>
        </div>
      )}

      {path === "/registrations" && creatingRegistration && facilityId && (
        <RegistrationCreatePanel
          facilityId={facilityId}
          onClose={() => setCreatingRegistration(false)}
          onCreated={() => refreshItems(Boolean(currentData))}
        />
      )}

      {selectedRecord && (
        <OperationalRecordPanel
          key={`${path}:${
            typeof selectedRecord.recordId === "string"
              ? selectedRecord.recordId
              : "record"
          }`}
          path={path}
          item={selectedRecord}
          onClose={() => setSelectedRecord(null)}
          onChanged={() => refreshItems(true)}
        />
      )}

      {facilitiesLoading && facilities.length === 0 ? (
        <section className="health-loading" aria-live="polite">Loading facilities…</section>
      ) : facilitiesError && facilities.length === 0 ? null : facilities.length === 0 ? (
        <section className="empty-state">
          <span aria-hidden="true">◇</span>
          <h2>No facilities configured</h2>
          <p>Add a facility and camera station before reviewing operational activity.</p>
        </section>
      ) : (
        <>
          {itemsError && (
            <div className="error-panel actionable-error" role="alert">
              <span>
                {itemsError}
                {currentData && " Showing the most recent successful results."}
              </span>
              <button className="secondary-button" type="button" onClick={() => void refreshItems(Boolean(currentData))}>
                Try again
              </button>
            </div>
          )}
          {initialDataLoading ? (
            <section className="health-loading" aria-live="polite">
              Loading {config.title.toLocaleLowerCase()}…
            </section>
          ) : initialDataFailed ? null : items.length === 0 ? (
            <section className="empty-state">
              <span aria-hidden="true">◇</span>
              <h2>{config.emptyTitle}</h2>
              <p>{config.emptyDescription}</p>
              <button className="secondary-button" type="button" onClick={() => void refreshItems()}>
                Check again
              </button>
            </section>
          ) : (
            <>
              <div className="table-status" aria-live="polite">
                <span>{items.length.toLocaleString()} {items.length === 1 ? "record" : "records"}</span>
                <span>
                  {itemsRefreshing
                    ? "Refreshing…"
                    : paginatedScope === scope
                      ? "Auto-refresh paused after loading older records"
                      : currentData && `Updated ${currentData.updatedAt.toLocaleTimeString()}`}
                </span>
              </div>
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">
                    {config.title} for the selected facility
                  </caption>
                  <thead>
                    <tr>
                      {fields.map((field) => (
                        <th key={field} scope="col">{fieldHeading(field)}</th>
                      ))}
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, row) => (
                      <tr key={typeof item.recordId === "string" ? item.recordId : String(row)}>
                        {fields.map((field) => <td key={field}>{displayValue(field, item[field])}</td>)}
                        <td>
                          <button
                            className="text-button"
                            type="button"
                            onClick={() => {
                              setCreatingRegistration(false);
                              setSelectedRecord(item);
                            }}
                          >
                            Open
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {currentData?.nextCursor && (
                <div className="load-more">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void loadMore()}
                    disabled={itemsRefreshing}
                  >
                    {itemsRefreshing ? "Loading more…" : "Load more"}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
