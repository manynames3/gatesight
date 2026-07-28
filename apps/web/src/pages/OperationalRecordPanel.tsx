import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { ApiClient } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { canAccess, verifiedRoles } from "../auth/roles";
import { StatusChip } from "../components/StatusChip";

export type OperationalPath =
  | "/observations"
  | "/visits/open"
  | "/visits"
  | "/registrations"
  | "/alerts";

interface MediaReference {
  url: string;
  expiresIn: number;
}

function words(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .trim()
    .toLocaleLowerCase()
    .replace(/\b\w/g, (letter) => letter.toLocaleUpperCase());
}

function valueText(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "string") {
    if (field.endsWith("At") || field === "capturedAt") {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return date.toLocaleString();
    }
    if (field === "state" || field === "status" || field === "direction") {
      return words(value);
    }
    return value;
  }
  return Array.isArray(value) ? value.map(String).join(", ") : "Available in audit data";
}

function mediaReferences(value: unknown): MediaReference[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is MediaReference =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as Record<string, unknown>).url === "string" &&
      typeof (item as Record<string, unknown>).expiresIn === "number",
  );
}

function tone(value: unknown): "good" | "warn" | "danger" | "neutral" {
  if (value === "RECOGNIZED" || value === "ACTIVE" || value === "RESOLVED") return "good";
  if (value === "FAILED" || value === "BLOCKED" || value === "OPEN") return "danger";
  if (
    value === "NEEDS_REVIEW" ||
    value === "NO_PLATE" ||
    value === "MULTIPLE_PLATES" ||
    value === "ACKNOWLEDGED"
  ) {
    return "warn";
  }
  return "neutral";
}

export function RegistrationCreatePanel({
  facilityId,
  onClose,
  onCreated,
}: {
  facilityId: string;
  onClose: () => void;
  onCreated: () => Promise<void> | void;
}) {
  const { getApiToken } = useAuth();
  const api = useMemo(
    () => new ApiClient(import.meta.env.VITE_API_ORIGIN, getApiToken),
    [getApiToken],
  );
  const [displayPlate, setDisplayPlate] = useState("");
  const [description, setDescription] = useState("");
  const [plateRegion, setPlateRegion] = useState("");
  const [status, setStatus] = useState<"ACTIVE" | "BLOCKED">("ACTIVE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const registrationIntent = useRef<{
    signature: string;
    key: string;
    validFrom: string;
  } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedPlate = displayPlate.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!normalizedPlate) {
      setError("Enter at least one plate letter or number.");
      return;
    }
    if (normalizedPlate.length > 12) {
      setError("Use no more than 12 plate letters or numbers.");
      return;
    }
    const requestFields = {
      normalizedPlate,
      displayPlate: displayPlate.trim().toUpperCase(),
      facilityId,
      ...(plateRegion.trim()
        ? { plateRegion: plateRegion.trim().toUpperCase() }
        : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      status,
    };
    const signature = JSON.stringify(requestFields);
    if (registrationIntent.current?.signature !== signature) {
      registrationIntent.current = {
        signature,
        key: `registration:${crypto.randomUUID()}`,
        validFrom: new Date().toISOString(),
      };
    }
    setBusy(true);
    setError(null);
    try {
      await api.createRegistration(
        {
          ...requestFields,
          validFrom: registrationIntent.current.validFrom,
        },
        registrationIntent.current.key,
      );
      registrationIntent.current = null;
      await onCreated();
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The vehicle could not be registered.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="record-panel" aria-labelledby="registration-create-title">
      <div className="record-panel-heading">
        <div>
          <p className="eyebrow">NEW AUTHORIZATION</p>
          <h2 id="registration-create-title">Register a vehicle</h2>
        </div>
        <button type="button" className="text-button" onClick={onClose}>
          Close
        </button>
      </div>
      {error && <div className="error-panel" role="alert">{error}</div>}
      <form className="record-form" onSubmit={(event) => void submit(event)}>
        <label>
          Plate
          <input
            value={displayPlate}
            onChange={(event) => setDisplayPlate(event.target.value)}
            placeholder="ABC 1234"
            autoComplete="off"
            maxLength={24}
            required
          />
        </label>
        <label>
          State or region (optional)
          <input
            value={plateRegion}
            onChange={(event) => setPlateRegion(event.target.value)}
            placeholder="MA"
            autoComplete="off"
            maxLength={24}
          />
        </label>
        <label>
          Access status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as "ACTIVE" | "BLOCKED")}
          >
            <option value="ACTIVE">Allowed</option>
            <option value="BLOCKED">Blocked</option>
          </select>
        </label>
        <label className="form-wide">
          Description (optional)
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Vendor, fleet, or reason for access"
            maxLength={240}
          />
        </label>
        <div className="form-actions form-wide">
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Register vehicle"}
          </button>
          <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}

export function OperationalRecordPanel({
  path,
  item,
  onClose,
  onChanged,
}: {
  path: OperationalPath;
  item: Record<string, unknown>;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const { getApiToken, user } = useAuth();
  const api = useMemo(
    () => new ApiClient(import.meta.env.VITE_API_ORIGIN, getApiToken),
    [getApiToken],
  );
  const roles = verifiedRoles(user?.profile["cognito:groups"]);
  const canReview = canAccess(roles, ["ADMIN", "SECURITY"]);
  const recordId = typeof item.recordId === "string" ? item.recordId : "";
  const [record, setRecord] = useState(item);
  const [loading, setLoading] = useState(path === "/observations");
  const [detailLoaded, setDetailLoaded] = useState(path !== "/observations");
  const [detailError, setDetailError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [decision, setDecision] = useState<"CONFIRMED" | "CORRECTED" | "REJECTED">(
    item.state === "RECOGNIZED" ? "CONFIRMED" : "CORRECTED",
  );
  const [correctedPlate, setCorrectedPlate] = useState("");
  const [note, setNote] = useState("");
  const detailRequest = useRef(0);
  const reviewIntent = useRef<{ signature: string; key: string } | null>(null);
  const alertIntent = useRef<{ action: "acknowledge" | "resolve"; key: string } | null>(
    null,
  );
  const mediaDeletionKey = useRef(
    `media-delete:${recordId}:${crypto.randomUUID()}`,
  );

  const loadObservation = useCallback(async () => {
    if (path !== "/observations" || !recordId) {
      setLoading(false);
      setDetailLoaded(true);
      return;
    }
    const requestId = ++detailRequest.current;
    setLoading(true);
    setDetailLoaded(false);
    setDetailError(null);
    try {
      const detail = await api.getObservation(recordId);
      if (requestId !== detailRequest.current) return;
      setRecord(detail);
      setDecision(detail.state === "RECOGNIZED" ? "CONFIRMED" : "CORRECTED");
      setDetailLoaded(true);
    } catch (caught) {
      if (requestId !== detailRequest.current) return;
      setDetailError(
        caught instanceof Error
          ? caught.message
          : "Observation details could not be loaded.",
      );
    } finally {
      if (requestId === detailRequest.current) setLoading(false);
    }
  }, [api, path, recordId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadObservation(), 0);
    return () => {
      window.clearTimeout(timer);
      detailRequest.current += 1;
    };
  }, [loadObservation]);

  const state = record.state ?? record.status;
  const media = mediaReferences(record.mediaUrls);
  const detailEntries = Object.entries(record)
    .filter(
      ([field, value]) =>
        ![
          "tenantId",
          "facilityId",
          "mediaUrls",
          "rawCandidates",
          "derivedCropKeys",
          "frameKeys",
        ].includes(field) &&
        (canReview || field !== "normalizedPlate") &&
        (typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean" ||
          value === null),
    )
    .slice(0, 18);

  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recordId || !detailLoaded) return;
    const trimmedNote = note.trim();
    if (trimmedNote.length < 3) {
      setError("Enter a review note with at least three non-space characters.");
      return;
    }
    const normalizedCorrection = correctedPlate
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    if (decision === "CORRECTED" && !normalizedCorrection) {
      setError("Enter at least one plate letter or number for the correction.");
      return;
    }
    const body = {
      decision,
      ...(decision === "CORRECTED"
        ? { correctedPlate: normalizedCorrection }
        : {}),
      note: trimmedNote,
    };
    const signature = JSON.stringify(body);
    if (reviewIntent.current?.signature !== signature) {
      reviewIntent.current = {
        signature,
        key: `review:${recordId}:${crypto.randomUUID()}`,
      };
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.reviewObservation(
        recordId,
        body,
        reviewIntent.current.key,
      );
      reviewIntent.current = null;
      setRecord((current) => ({
        ...current,
        reviewDecision: decision,
        ...(typeof result.state === "string" ? { state: result.state } : {}),
        ...(decision === "CORRECTED"
          ? { normalizedPlate: normalizedCorrection }
          : {}),
      }));
      setNotice(
        decision === "CORRECTED"
          ? "Review saved. The corrected plate is being applied to visits and alerts."
          : decision === "REJECTED"
            ? "Review saved. No visit or alert will be created for this observation."
            : "Review saved. Existing operational records are unchanged.",
      );
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The review could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function updateRegistration(status: "ACTIVE" | "BLOCKED") {
    if (!recordId) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateRegistration(recordId, { status });
      setRecord((current) => ({ ...current, ...updated }));
      setNotice(status === "BLOCKED" ? "Vehicle marked as blocked." : "Vehicle access restored.");
      await onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The registration could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function transitionAlert(action: "acknowledge" | "resolve") {
    if (!recordId) return;
    if (
      action === "resolve" &&
      !window.confirm(
        `Resolve alert ${recordId}? This finalizes the alert and cannot be undone.`,
      )
    ) {
      return;
    }
    if (alertIntent.current?.action !== action) {
      alertIntent.current = {
        action,
        key: `alert:${recordId}:${action}:${crypto.randomUUID()}`,
      };
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await api.transitionAlert(
        recordId,
        action,
        alertIntent.current.key,
      );
      alertIntent.current = null;
      setRecord((current) => ({ ...current, ...updated }));
      setNotice(action === "acknowledge" ? "Alert acknowledged." : "Alert resolved.");
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The alert could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteMedia() {
    if (!recordId || !detailLoaded) return;
    if (
      !window.confirm(
        `Remove all saved media for observation ${recordId} from GateSight now? The audit record remains. Versioned copies expire under the configured retention policy.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.deleteObservationMedia(
        recordId,
        mediaDeletionKey.current,
      );
      setRecord((current) => ({
        ...current,
        mediaUrls: [],
        mediaAvailable: false,
        mediaDeletedAt: result.mediaDeletedAt,
      }));
      setNotice(
        "Observation media was removed from the app. Versioned copies expire under the configured retention policy; the audit record remains.",
      );
      await onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The saved media could not be deleted.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="record-panel" aria-labelledby="record-detail-title">
      <div className="record-panel-heading">
        <div>
          <p className="eyebrow">RECORD DETAILS</p>
          <h2 id="record-detail-title">{recordId || "Operational record"}</h2>
        </div>
        <button type="button" className="text-button" onClick={onClose}>
          Close
        </button>
      </div>

      {detailError && (
        <div className="error-panel actionable-error" role="alert">
          <span>
            {detailError} Review actions stay disabled until protected details load.
          </span>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void loadObservation()}
            disabled={loading}
          >
            Retry details
          </button>
        </div>
      )}
      {error && <div className="error-panel" role="alert">{error}</div>}
      {notice && <div className="success-panel" role="status">{notice}</div>}
      {loading ? (
        <p className="muted" aria-live="polite">Loading protected record details…</p>
      ) : (
        <>
          {typeof state === "string" && (
            <StatusChip tone={tone(state)}>{words(state)}</StatusChip>
          )}
          <dl className="record-details">
            {detailEntries.map(([field, value]) => (
              <div key={field}>
                <dt>{words(field)}</dt>
                <dd>{valueText(field, value)}</dd>
              </div>
            ))}
          </dl>

          {media.length > 0 && (
            <div className="evidence-grid">
              {media.map((reference, index) => (
                <figure key={reference.url}>
                  <img
                    src={reference.url}
                    alt={`Captured gate evidence frame ${index + 1}`}
                    loading="eager"
                  />
                  <figcaption>Frame {index + 1} · temporary protected link</figcaption>
                </figure>
              ))}
            </div>
          )}

          {path === "/observations" &&
            canReview &&
            detailLoaded &&
            (!record.reviewDecision || record.reviewDecision === "PENDING") && (
            <form className="review-form" onSubmit={(event) => void review(event)}>
              <h3>Complete human review</h3>
              <label>
                Decision
                <select
                  value={decision}
                  onChange={(event) =>
                    setDecision(
                      event.target.value as "CONFIRMED" | "CORRECTED" | "REJECTED",
                    )
                  }
                >
                  {record.state === "RECOGNIZED" ? (
                    <option value="CONFIRMED">Confirm model result</option>
                  ) : (
                    <>
                      <option value="CORRECTED">Correct plate reading</option>
                      <option value="REJECTED">Reject result</option>
                    </>
                  )}
                </select>
              </label>
              {decision === "CORRECTED" && (
                <label>
                  Correct plate
                  <input
                    value={correctedPlate}
                    onChange={(event) => setCorrectedPlate(event.target.value)}
                    maxLength={24}
                    autoComplete="off"
                    required
                  />
                </label>
              )}
              <label>
                Review note
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  minLength={3}
                  maxLength={1000}
                  required
                />
              </label>
              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? "Saving review…" : "Save review"}
              </button>
            </form>
          )}

          {path === "/observations" &&
            canReview &&
            detailLoaded &&
            (media.length > 0 || record.mediaAvailable === true) && (
              <div className="record-action-bar">
                <button
                  className="danger-button"
                  type="button"
                  onClick={() => void deleteMedia()}
                  disabled={busy}
                >
                  Delete saved media
                </button>
              </div>
            )}

          {path === "/registrations" && (
            <div className="record-action-bar">
              {record.status === "BLOCKED" ? (
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void updateRegistration("ACTIVE")}
                  disabled={busy}
                >
                  Restore access
                </button>
              ) : (
                <button
                  className="danger-button"
                  type="button"
                  onClick={() => void updateRegistration("BLOCKED")}
                  disabled={busy}
                >
                  Block vehicle
                </button>
              )}
            </div>
          )}

          {path === "/alerts" && record.status !== "RESOLVED" && (
            <div className="record-action-bar">
              {record.status === "OPEN" && (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void transitionAlert("acknowledge")}
                  disabled={busy}
                >
                  Acknowledge
                </button>
              )}
              <button
                className="primary-button"
                type="button"
                onClick={() => void transitionAlert("resolve")}
                disabled={busy}
              >
                Resolve alert
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
