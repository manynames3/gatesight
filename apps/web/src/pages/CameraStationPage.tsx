import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { ApiClient } from "../api/client";
import type {
  CaptureResult,
  Facility,
  Station,
} from "../api/generated";
import { pollCapture } from "../api/poll";
import { captureBurst } from "../camera/capture";
import {
  MotionDetector,
  MotionStabilityTracker,
  type AutomaticCaptureState,
} from "../camera/motion";
import {
  assessCapturedPlate,
  burstResemblesPlate,
  captureGuidance,
  selectBestFrameIndices,
  shouldStartAutomaticCapture,
  tryAssessLivePlate,
} from "../camera/plateGate";
import { guideRegion } from "../camera/region";
import type { PendingBurst } from "../camera/types";
import { uploadFrame } from "../camera/upload";
import { StatusChip } from "../components/StatusChip";
import { useCamera } from "../hooks/useCamera";

const terminalNeedsReview = new Set(["NEEDS_REVIEW", "NO_PLATE", "MULTIPLE_PLATES"]);
const terminalCaptureStatuses = new Set(["RECOGNIZED", "NEEDS_REVIEW", "NO_PLATE", "MULTIPLE_PLATES", "FAILED"]);

function captureStatusLabel(status: CaptureResult["status"]): string {
  if (status === "NO_PLATE") return "NOT DETECTED — REVIEW";
  return status.replaceAll("_", " ");
}

function captureStatusDescription(result: CaptureResult): string {
  if (result.status === "UPLOADING") return "Saving the selected frames to AWS.";
  if (result.status === "QUEUED") return "Saved in AWS and waiting for recognition.";
  if (result.status === "PROCESSING") return "Recognition is running. The station remains ready.";
  if (result.status === "RECOGNIZED") return "A plate was recognized and an observation was created.";
  if (result.status === "NEEDS_REVIEW" || result.status === "NO_PLATE") {
    return "The image is saved, but the reading needs a person to review it.";
  }
  if (result.status === "MULTIPLE_PLATES") {
    return "More than one possible plate was found. Review is required.";
  }
  return result.failureCode
    ? `Recognition could not finish (${result.failureCode}). The saved capture can be retried by an administrator.`
    : "Recognition could not finish. The saved capture can be retried by an administrator.";
}

function CaptureTimeline({ status }: { status: CaptureResult["status"] }) {
  const saved = status !== "UPLOADING";
  const finished = terminalCaptureStatuses.has(status);
  const resultLabel = status === "RECOGNIZED"
    ? "Recognized"
    : status === "FAILED"
      ? "Needs attention"
      : finished
        ? "Human review"
        : "Result";
  const steps = [
    { label: "Captured", state: "complete" },
    { label: "Saved to AWS", state: saved ? "complete" : "active" },
    { label: "Reading plate", state: finished ? "complete" : saved ? "active" : "waiting" },
    { label: resultLabel, state: finished ? "complete" : "waiting" },
  ];

  return (
    <ol className="capture-timeline" aria-label="Capture progress">
      {steps.map((step) => (
        <li key={step.label} className={`capture-step ${step.state}`}>
          <span aria-hidden="true" />
          {step.label}
        </li>
      ))}
    </ol>
  );
}

function captureKey(prefix: string, burstId: string) {
  return `${prefix}:${burstId}`;
}

async function cameraHash(deviceId: string): Promise<string | null> {
  if (!deviceId) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(deviceId));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function CameraStationPage() {
  const { getApiToken } = useAuth();
  const api = useMemo(
    () => new ApiClient(import.meta.env.VITE_API_ORIGIN, getApiToken),
    [getApiToken],
  );
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const motionCanvasRef = useRef<HTMLCanvasElement>(null);
  const plateGuideRef = useRef<HTMLDivElement>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const detectorRef = useRef(new MotionDetector());
  const stabilityTrackerRef = useRef(new MotionStabilityTracker());
  const lastCaptureAtRef = useRef(0);
  const facilityRequestRef = useRef(0);
  const stationRequestRef = useRef(0);
  const wasOnlineRef = useRef(navigator.onLine);
  const {
    videoRef,
    streamRef,
    permission: cameraPermission,
    devices: cameras,
    selectedDeviceId: cameraDeviceId,
    resolution: cameraResolution,
    lowResolution: cameraLowResolution,
    error: cameraError,
    start: startCamera,
    refreshDevices: refreshCameras,
    select: selectCamera,
  } = useCamera();
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [facilityId, setFacilityId] = useState("");
  const [stationId, setStationId] = useState("");
  const [facilitiesLoading, setFacilitiesLoading] = useState(true);
  const [stationsLoading, setStationsLoading] = useState(false);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [heartbeat, setHeartbeat] = useState<"idle" | "sending" | "healthy" | "stale">("idle");
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());
  const [motionState, setMotionState] = useState<AutomaticCaptureState>("watching");
  const [pending, setPending] = useState<PendingBurst | null>(null);
  const [progress, setProgress] = useState<number[]>([]);
  const [captureResult, setCaptureResult] = useState<CaptureResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [captureStatusUnavailable, setCaptureStatusUnavailable] = useState(false);
  const [resultRefreshBusy, setResultRefreshBusy] = useState(false);

  const station = stations.find((item) => item.recordId === stationId);
  const facility = facilities.find((item) => item.recordId === facilityId);
  const armed =
    cameraPermission === "granted" && Boolean(facility && station);

  const currentPlateRegion = useCallback(() => {
    if (!videoRef.current || !plateGuideRef.current) return null;
    return guideRegion(videoRef.current, plateGuideRef.current);
  }, [videoRef]);

  const loadFacilities = useCallback(async () => {
    const request = facilityRequestRef.current + 1;
    facilityRequestRef.current = request;
    setFacilitiesLoading(true);
    setAssignmentError(null);
    try {
      const page = await api.getFacilities();
      if (request !== facilityRequestRef.current) return;
      setFacilities(page.items);
      setFacilityId((current) =>
        page.items.some((item) => item.recordId === current)
          ? current
          : page.items[0]?.recordId ?? "",
      );
      if (page.items.length === 0) {
        stationRequestRef.current += 1;
        setStations([]);
        setStationId("");
        setStationsLoading(false);
        setAssignmentError(
          "No facilities are assigned to this identity. Ask an administrator to grant facility access.",
        );
      }
    } catch (error) {
      if (request !== facilityRequestRef.current) return;
      setAssignmentError(
        error instanceof Error ? error.message : "Facilities could not be loaded.",
      );
    } finally {
      if (request === facilityRequestRef.current) setFacilitiesLoading(false);
    }
  }, [api]);

  const loadStations = useCallback(
    async (nextFacilityId: string) => {
      const request = stationRequestRef.current + 1;
      stationRequestRef.current = request;
      setStationsLoading(true);
      setAssignmentError(null);
      setStations([]);
      setStationId("");
      try {
        const page = await api.getStations(nextFacilityId);
        if (request !== stationRequestRef.current) return;
        setStations(page.items);
        setStationId(page.items[0]?.recordId ?? "");
        if (page.items.length === 0) {
          setAssignmentError(
            "This facility has no logical gates. Configure an entry or exit station before capturing.",
          );
        }
      } catch (error) {
        if (request !== stationRequestRef.current) return;
        setAssignmentError(
          error instanceof Error ? error.message : "Logical gates could not be loaded.",
        );
      } finally {
        if (request === stationRequestRef.current) setStationsLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void loadFacilities(), 0);
    return () => {
      window.clearTimeout(timer);
      facilityRequestRef.current += 1;
    };
  }, [loadFacilities]);

  useEffect(() => {
    if (!facilityId) {
      stationRequestRef.current += 1;
      return;
    }
    const timer = window.setTimeout(() => void loadStations(facilityId), 0);
    return () => {
      window.clearTimeout(timer);
      stationRequestRef.current += 1;
    };
  }, [facilityId, loadStations]);

  useEffect(() => {
    const onlineHandler = () => setOnline(true);
    const offlineHandler = () => setOnline(false);
    window.addEventListener("online", onlineHandler);
    window.addEventListener("offline", offlineHandler);
    return () => {
      window.removeEventListener("online", onlineHandler);
      window.removeEventListener("offline", offlineHandler);
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setClockNowMs(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (pending) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [pending]);

  useEffect(
    () => () => {
      uploadAbortRef.current?.abort();
      pollAbortRef.current?.abort();
    },
    [],
  );

  const syncClock = useCallback(async () => {
    const samples: Array<{ latency: number; offset: number }> = [];
    for (let index = 0; index < 3; index += 1) {
      const before = Date.now();
      const response = await api.getServerTime();
      const after = Date.now();
      samples.push({
        latency: after - before,
        offset: response.unixTimeMs - Math.round((before + after) / 2),
      });
    }
    samples.sort((left, right) => left.latency - right.latency);
    const offset = samples[0]?.offset ?? 0;
    setClockOffsetMs(offset);
    return offset;
  }, [api]);

  const acquireWakeLock = useCallback(async () => {
    if ("wakeLock" in navigator && document.visibilityState === "visible") {
      wakeLockRef.current = await navigator.wakeLock.request("screen");
    }
  }, []);

  useEffect(() => {
    const detector = detectorRef.current;
    const stabilityTracker = stabilityTrackerRef.current;
    detector.reset();
    stabilityTracker.reset();
    if (!armed) {
      void wakeLockRef.current?.release();
      wakeLockRef.current = null;
      return;
    }
    const clockTimer = window.setTimeout(() => {
      void syncClock().catch((error: unknown) => {
        setMessage(
          error instanceof Error
            ? error.message
            : "Station clock could not be synchronized",
        );
      });
    }, 0);
    void acquireWakeLock().catch(() => undefined);
    return () => {
      window.clearTimeout(clockTimer);
      detector.reset();
      stabilityTracker.reset();
      void wakeLockRef.current?.release();
      wakeLockRef.current = null;
    };
  }, [acquireWakeLock, armed, cameraDeviceId, facilityId, stationId, syncClock]);

  useEffect(() => {
    const visible = () => {
      if (armed && document.visibilityState === "visible") {
        void acquireWakeLock().catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, [acquireWakeLock, armed]);

  useEffect(() => {
    if (!armed || !stationId) return;
    let active = true;
    const send = async () => {
      setHeartbeat("sending");
      try {
        await api.heartbeat(stationId, {
          armed: true,
          client_time: new Date().toISOString(),
          camera_device_hash: await cameraHash(cameraDeviceId),
        });
        if (active) setHeartbeat("healthy");
      } catch {
        if (active) setHeartbeat("stale");
      }
    };
    void send();
    const interval = window.setInterval(() => void send(), 20_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [api, armed, cameraDeviceId, stationId]);

  const processBurst = useCallback(
    async (burst: PendingBurst) => {
      if (!facility || !station) throw new Error("Station selection changed during capture");
      const abort = new AbortController();
      uploadAbortRef.current = abort;
      setProgress(Array.from({ length: burst.frames.length }, () => 0));
      const session = await api.createCapture(
        {
          facilityId: facility.recordId,
          stationId: station.recordId,
          frameCount: burst.frames.length,
          capturedAtClient: burst.capturedAt.toISOString(),
          clientClockOffsetMs: clockOffsetMs,
          guideRegion: burst.guideRegion,
        },
        captureKey("create", burst.id),
      );
      const uploadBatch = async (uploads: typeof session.uploads) => {
        const results = await Promise.allSettled(
          uploads.map(async (upload) => {
          const frame = burst.frames[upload.frameIndex];
          if (!frame) throw new Error("Upload session frame count mismatch");
          await uploadFrame(upload, frame, abort.signal, (percent) => {
            setProgress((current) =>
              current.map((value, itemIndex) =>
                itemIndex === upload.frameIndex ? percent : value,
              ),
            );
          });
          }),
        );
        return results.filter((result) => result.status === "rejected");
      };
      let failures = await uploadBatch(session.uploads);
      for (let refreshAttempt = 0; failures.length > 0 && refreshAttempt < 2; refreshAttempt += 1) {
        const refreshed = await api.refreshCaptureUploads(session.captureId);
        if (refreshed.uploads.length === 0) {
          failures = [];
          break;
        }
        failures = await uploadBatch(refreshed.uploads);
      }
      if (failures.length > 0) {
        const failure = failures[0];
        throw failure?.status === "rejected" ? failure.reason : new Error("Upload failed");
      }
      await api.completeCapture(
        session.captureId,
        session.uploads.map((upload) => upload.key),
        captureKey("complete", burst.id),
      );
      setPending(null);
      setProgress([]);
      setCaptureResult({ recordId: session.captureId, status: "QUEUED" });
      setCaptureStatusUnavailable(false);
      setSaveNotice(`Capture ${session.captureId} is verified in AWS.`);
      pollAbortRef.current?.abort();
      const pollAbort = new AbortController();
      pollAbortRef.current = pollAbort;
      void pollCapture(api, session.captureId, pollAbort.signal, setCaptureResult)
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            setCaptureStatusUnavailable(true);
            setSaveNotice(
              `Capture ${session.captureId} is saved in AWS; recognition status is temporarily unavailable.`,
            );
          }
        })
        .finally(() => {
          if (pollAbortRef.current === pollAbort) pollAbortRef.current = null;
        });
    },
    [api, clockOffsetMs, facility, station],
  );

  const captureNow = useCallback(async () => {
    if (
      busy ||
      pending ||
      !streamRef.current ||
      !videoRef.current ||
      !captureCanvasRef.current
    ) {
      return;
    }
    if (!facility || !station) {
      setMessage("Select a facility and station before capturing.");
      return;
    }
    setBusy(true);
    setMessage(null);
    setSaveNotice(null);
    setCaptureResult(null);
    let burst: PendingBurst | null = null;
    try {
      const region = currentPlateRegion();
      if (!region) {
        setMessage("The camera is still preparing the plate guide. Try again in a moment.");
        return;
      }
      const capturedAt = new Date();
      let frames = await captureBurst(
        streamRef.current,
        videoRef.current,
        captureCanvasRef.current,
        5,
        220,
        350,
      );
      const assessments = [];
      for (const frame of frames) {
        assessments.push(await assessCapturedPlate(frame, captureCanvasRef.current, region));
      }
      if (!burstResemblesPlate(assessments)) {
        frames.length = 0;
        lastCaptureAtRef.current = Date.now();
        setMessage(
          `The five-frame check found no complete plate-shaped object with reliable character structure. Nothing was uploaded. ${captureGuidance(assessments)}`,
        );
        return;
      }
      const selectedIndices = selectBestFrameIndices(assessments, 4);
      frames = selectedIndices.map((index) => frames[index]!).filter(Boolean);
      burst = { id: crypto.randomUUID(), capturedAt, frames, guideRegion: region };
      setPending(burst);
      lastCaptureAtRef.current = Date.now();
      if (!online) {
        setMessage(
          "The plate was captured and is retained in this tab. Keep this page open; GateSight will save it to AWS when the connection returns.",
        );
        return;
      }
      await processBurst(burst);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        const reason = error instanceof Error ? error.message : "Capture failed";
        setMessage(
          burst
            ? `Capture is retained in this tab but is not yet verified in AWS: ${reason}`
            : `No image was taken: ${reason}`,
        );
      }
    } finally {
      uploadAbortRef.current = null;
      setBusy(false);
    }
  }, [
    busy,
    currentPlateRegion,
    facility,
    online,
    pending,
    processBurst,
    station,
    streamRef,
    videoRef,
  ]);

  const retryPending = useCallback(async () => {
    if (!pending || busy || !online) return;
    setBusy(true);
    setMessage(null);
    setSaveNotice(null);
    try {
      await processBurst(pending);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        const reason = error instanceof Error ? error.message : "Upload failed";
        setMessage(
          `Capture is retained in this tab but is not yet verified in AWS: ${reason}`,
        );
      }
    } finally {
      uploadAbortRef.current = null;
      setBusy(false);
    }
  }, [busy, online, pending, processBurst]);

  useEffect(() => {
    const reconnected = !wasOnlineRef.current && online;
    wasOnlineRef.current = online;
    if (!reconnected || !pending || busy) return;
    const retry = window.setTimeout(() => void retryPending(), 0);
    return () => window.clearTimeout(retry);
  }, [busy, online, pending, retryPending]);

  const refreshLatestCapture = useCallback(async () => {
    if (!captureResult || resultRefreshBusy) return;
    setResultRefreshBusy(true);
    setMessage(null);
    try {
      setCaptureResult(await api.getCapture(captureResult.recordId));
      setCaptureStatusUnavailable(false);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The latest recognition status could not be refreshed.",
      );
    } finally {
      setResultRefreshBusy(false);
    }
  }, [api, captureResult, resultRefreshBusy]);

  useEffect(() => {
    if (!armed) return;
    let frame = 0;
    let lastSample = 0;
    const loop = (timestamp: number) => {
      if (
        timestamp - lastSample >= 120 &&
        videoRef.current &&
        captureCanvasRef.current &&
        motionCanvasRef.current &&
        !busy &&
        !pending
      ) {
        lastSample = timestamp;
        const region = currentPlateRegion();
        if (!region) {
          frame = requestAnimationFrame(loop);
          return;
        }
        const sample = detectorRef.current.sample(
          videoRef.current,
          motionCanvasRef.current,
          region,
        );
        const stability = stabilityTrackerRef.current.update(
          sample.moving,
          Date.now(),
        );
        setMotionState(stability.state);
        const cooldownElapsed = Date.now() - lastCaptureAtRef.current > 15_000;
        if (stability.shouldCapture && cooldownElapsed) {
          const check = tryAssessLivePlate(
            videoRef.current,
            captureCanvasRef.current,
            region,
          );
          stabilityTrackerRef.current.reset();
          setMotionState("watching");
          if (check.assessment === null) {
            setMessage(`Automatic plate check could not inspect the guide: ${check.error}`);
          } else if (shouldStartAutomaticCapture(check.assessment)) {
            void captureNow();
          }
        }
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [armed, busy, captureNow, currentPlateRegion, pending, videoRef]);

  const discard = () => {
    uploadAbortRef.current?.abort();
    setPending(null);
    setProgress([]);
    setMessage("Pending in-memory frames were discarded.");
  };

  const selectFacility = (nextFacilityId: string) => {
    setFacilityId(nextFacilityId);
    setStations([]);
    setStationId("");
  };

  const localTime = facility
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "medium",
        timeZone: facility.timezone,
      }).format(new Date(clockNowMs + clockOffsetMs))
    : "—";

  return (
    <div className="page station-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">LIVE GATE</p>
          <h1>Camera station</h1>
          <p>
            Plate shape and character structure are checked locally before anything is
            retained or uploaded.
          </p>
        </div>
        <div className="header-status">
          <StatusChip tone={online ? "good" : "danger"}>{online ? "Online" : "Offline"}</StatusChip>
          <StatusChip tone={heartbeat === "healthy" ? "good" : heartbeat === "stale" ? "danger" : "neutral"}>
            Heartbeat {heartbeat}
          </StatusChip>
          <StatusChip tone={pending ? "warn" : armed ? "good" : "neutral"}>
            {pending ? "Pending save" : armed ? "Automatic" : "Waiting"}
          </StatusChip>
        </div>
      </header>

      {message && (
        <div className={pending ? "review-warning" : "error-panel"} role="alert">
          {message}
        </div>
      )}
      {saveNotice && <div className="success-panel" role="status">{saveNotice}</div>}
      {captureResult && terminalNeedsReview.has(captureResult.status) && (
        <div className="review-warning" role="status">
          This result needs human review. It cannot create an unregistered-vehicle alert.
        </div>
      )}

      <section className="station-grid">
        <div className="camera-panel">
          <div className="camera-viewport">
            <video
              ref={videoRef}
              muted
              playsInline
              aria-label="Live gate camera"
              aria-describedby="plate-alignment-instructions"
            />
            <p id="plate-alignment-instructions" className="sr-only">
              Position one vehicle plate inside the centered two-to-one guide. Keep the
              characters level, evenly lit, and large enough to read.
            </p>
            <div ref={plateGuideRef} className="plate-region" aria-hidden="true">
              <span>ALIGN PLATE</span>
            </div>
            <div className="camera-overlay" aria-live="polite">
              <span>{station?.direction ?? "SELECT DIRECTION"}</span>
              <span>{pending ? "SAVE PENDING" : armed ? motionState.toUpperCase() : "IDLE"}</span>
            </div>
            {cameraPermission !== "granted" && (
              <div className="camera-idle" aria-hidden="true">
                <span className="camera-idle-mark" />
                <strong>Camera ready when you are</strong>
                <small>Choose a source below to begin the live gate view.</small>
              </div>
            )}
          </div>
          <canvas ref={captureCanvasRef} hidden />
          <canvas ref={motionCanvasRef} hidden />
          <div className="camera-actions">
            <div className="automatic-capture-summary">
              <span className={armed ? "mode-indicator active" : "mode-indicator"} aria-hidden="true" />
              <div className="mode-copy">
                <strong>Automatic capture</strong>
                <small>
                  {armed
                    ? "On · captures only when a plate-like object is stable in the guide"
                    : "Standby · select a station and enable the camera"}
                </small>
              </div>
            </div>
            <div className="camera-source-picker">
              <label htmlFor="camera-source">Camera source</label>
              <div className="camera-source-row">
                <select
                  id="camera-source"
                  value={cameraDeviceId}
                  onChange={(event) => void selectCamera(event.target.value)}
                  disabled={busy || pending !== null || cameraPermission === "requesting"}
                >
                  <option value="">Automatic (rear camera preferred)</option>
                  {cameras.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Camera ${index + 1}`}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void refreshCameras()}
                  disabled={busy || pending !== null || cameraPermission === "requesting"}
                >
                  Refresh
                </button>
              </div>
              <p>
                {cameraPermission === "granted"
                  ? "Choose any camera connected to this device."
                  : "Enable access once to reveal camera names, then choose the source."}
              </p>
            </div>
            <div className="camera-action-buttons">
              {cameraPermission !== "granted" ? (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void startCamera(cameraDeviceId || undefined)}
                  disabled={cameraPermission === "requesting"}
                >
                  {cameraPermission === "requesting"
                    ? "Requesting camera access…"
                    : "Enable camera & find devices"}
                </button>
              ) : (
                <button
                  type="button"
                  className="capture-button"
                  disabled={busy || pending !== null || !facility || !station}
                  onClick={() => void captureNow()}
                >
                  {busy
                    ? "Capturing / uploading…"
                    : pending
                      ? online
                        ? "Save the pending capture first"
                        : "Pending capture waits for network"
                      : !facility || !station
                        ? "Select a station to capture"
                        : online
                          ? "Capture now"
                          : "Capture now — save when online"}
                </button>
              )}
            </div>
          </div>
        </div>

        <aside className="station-controls">
          <section className="control-card">
            <h2>Station assignment</h2>
            <label>
              Facility
              <select
                value={facilityId}
                onChange={(event) => selectFacility(event.target.value)}
                disabled={busy || pending !== null || facilitiesLoading}
              >
                <option value="">
                  {facilitiesLoading ? "Loading facilities…" : "Select facility"}
                </option>
                {facilities.map((item) => <option key={item.recordId} value={item.recordId}>{item.name}</option>)}
              </select>
            </label>
            <label>
              Logical gate
              <select
                value={stationId}
                onChange={(event) => setStationId(event.target.value)}
                disabled={busy || pending !== null || stationsLoading || !facilityId}
              >
                <option value="">
                  {stationsLoading ? "Loading logical gates…" : "Select station"}
                </option>
                {stations.map((item) => <option key={item.recordId} value={item.recordId}>{item.name} · {item.direction}</option>)}
              </select>
            </label>
            {assignmentError && (
              <div className="inline-error" role="alert">
                <p>{assignmentError}</p>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    facilityId ? void loadStations(facilityId) : void loadFacilities()
                  }
                  disabled={facilitiesLoading || stationsLoading}
                >
                  Retry station setup
                </button>
              </div>
            )}
            <dl className="detail-list">
              <div><dt>Permission</dt><dd>{cameraPermission}</dd></div>
              <div>
                <dt>Resolution</dt>
                <dd>
                  {cameraResolution
                    ? `${cameraResolution.width} × ${cameraResolution.height}`
                    : "—"}
                </dd>
              </div>
              <div><dt>Direction</dt><dd>{station?.direction ?? "—"}</dd></div>
              <div><dt>Facility time</dt><dd>{localTime}</dd></div>
              <div><dt>Clock offset</dt><dd>{clockOffsetMs} ms</dd></div>
            </dl>
            {cameraError && <p className="field-error">{cameraError}</p>}
            {cameraLowResolution && (
              <p className="field-error" role="status">
                Camera resolution is below 1280 × 720. Recognition quality may be
                reduced; use a 1080p source when available.
              </p>
            )}
          </section>

          {(pending || progress.length > 0) && (
            <section className="control-card">
              <div className="card-title-row">
                <h2>In-memory burst</h2>
                {pending && (
                  <div className="card-actions">
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => void retryPending()}
                      disabled={busy || !online}
                    >
                      {busy ? "Saving…" : "Retry AWS save"}
                    </button>
                    <button type="button" className="text-button" onClick={discard}>
                      Discard
                    </button>
                  </div>
                )}
              </div>
              {progress.map((value, index) => (
                <div className="progress-row" key={`frame-${index}`}>
                  <span>Frame {index + 1}</span>
                  <progress value={value} max={100} aria-label={`Frame ${index + 1} upload progress`} />
                  <span>{value}%</span>
                </div>
              ))}
            </section>
          )}

          <section className="control-card result-card" aria-live="polite">
            <div className="card-title-row">
              <div>
                <p className="card-kicker">CAPTURE PIPELINE</p>
                <h2>Latest capture</h2>
              </div>
              {captureResult && (
              <StatusChip tone={captureResult.status === "RECOGNIZED" ? "good" : captureResult.status === "FAILED" ? "danger" : "warn"}>
                {captureStatusLabel(captureResult.status)}
              </StatusChip>
              )}
            </div>
            {captureResult ? (
              <>
              <CaptureTimeline status={captureResult.status} />
              <p className="result-summary">{captureStatusDescription(captureResult)}</p>
              <div className="result-actions">
                {captureResult.observationId && (
                  <Link
                    className="secondary-button button-link"
                    to={`/observations?facility=${encodeURIComponent(
                      facilityId,
                    )}&record=${encodeURIComponent(captureResult.observationId)}`}
                  >
                    View observation
                  </Link>
                )}
                {(captureStatusUnavailable ||
                  captureResult.status === "QUEUED" ||
                  captureResult.status === "PROCESSING") && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => void refreshLatestCapture()}
                    disabled={resultRefreshBusy}
                  >
                    {resultRefreshBusy ? "Checking…" : "Check status again"}
                  </button>
                )}
              </div>
              <details className="technical-details">
                <summary>Technical details</summary>
                <p>Capture ID</p>
                <code>{captureResult.recordId}</code>
              </details>
              </>
            ) : (
              <div className="result-empty">
                <span aria-hidden="true">◎</span>
                <p>No capture yet</p>
                <small>The most recent plate result will appear here.</small>
              </div>
            )}
          </section>
        </aside>
      </section>
    </div>
  );
}
