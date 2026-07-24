import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { ApiClient } from "../api/client";
import type {
  CaptureResult,
  Facility,
  Station,
} from "../api/generated";
import { pollCapture } from "../api/poll";
import { captureBurst } from "../camera/capture";
import { MotionDetector } from "../camera/motion";
import type { PendingBurst } from "../camera/types";
import { uploadFrame } from "../camera/upload";
import { StatusChip } from "../components/StatusChip";
import { useCamera } from "../hooks/useCamera";

const region = { x: 0.18, y: 0.52, width: 0.64, height: 0.25 };
const terminalNeedsReview = new Set(["NEEDS_REVIEW", "MULTIPLE_PLATES"]);

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
  const uploadAbortRef = useRef<AbortController | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const detectorRef = useRef(new MotionDetector());
  const motionSeenAtRef = useRef<number | null>(null);
  const lastCaptureAtRef = useRef(0);
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
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [armed, setArmed] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [heartbeat, setHeartbeat] = useState<"idle" | "sending" | "healthy" | "stale">("idle");
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());
  const [motionState, setMotionState] = useState<"idle" | "watching" | "moving" | "stabilizing">(
    "idle",
  );
  const [pending, setPending] = useState<PendingBurst | null>(null);
  const [progress, setProgress] = useState<number[]>([]);
  const [captureResult, setCaptureResult] = useState<CaptureResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const station = stations.find((item) => item.recordId === stationId);
  const facility = facilities.find((item) => item.recordId === facilityId);

  useEffect(() => {
    let active = true;
    api
      .getFacilities()
      .then((page) => {
        if (active) {
          setFacilities(page.items);
          if (page.items[0]) setFacilityId(page.items[0].recordId);
        }
      })
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)));
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    if (!facilityId) return;
    api
      .getStations(facilityId)
      .then((page) => {
        setStations(page.items);
        setStationId(page.items[0]?.recordId ?? "");
      })
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)));
  }, [api, facilityId]);

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

  const disarm = useCallback(() => {
    setArmed(false);
    setMotionState("idle");
    detectorRef.current.reset();
    motionSeenAtRef.current = null;
    void wakeLockRef.current?.release();
    wakeLockRef.current = null;
  }, []);

  const arm = useCallback(async () => {
    if (!privacyAccepted) {
      setMessage("Acknowledge the camera and privacy notice before arming.");
      return;
    }
    if (!facility || !station || cameraPermission !== "granted") {
      setMessage("Select a facility, station, and working camera before arming.");
      return;
    }
    try {
      await syncClock();
      await acquireWakeLock();
      setMessage(null);
      setArmed(true);
      setMotionState("watching");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Station could not be armed");
    }
  }, [acquireWakeLock, cameraPermission, facility, privacyAccepted, station, syncClock]);

  useEffect(() => {
    const visible = () => {
      if (armed && document.visibilityState === "visible") void acquireWakeLock();
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
        },
        captureKey("create", burst.id),
      );
      await Promise.all(
        session.uploads.map(async (upload, index) => {
          const frame = burst.frames[index];
          if (!frame) throw new Error("Upload session frame count mismatch");
          await uploadFrame(upload, frame, abort.signal, (percent) => {
            setProgress((current) =>
              current.map((value, itemIndex) => (itemIndex === index ? percent : value)),
            );
          });
        }),
      );
      await api.completeCapture(
        session.captureId,
        session.uploads.map((upload) => upload.key),
        captureKey("complete", burst.id),
      );
      setPending(null);
      setProgress([]);
      setCaptureResult({ recordId: session.captureId, status: "QUEUED" });
      setSaveNotice(`Capture ${session.captureId} is verified in AWS.`);
      pollAbortRef.current?.abort();
      const pollAbort = new AbortController();
      pollAbortRef.current = pollAbort;
      void pollCapture(api, session.captureId, pollAbort.signal, setCaptureResult)
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
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
      !streamRef.current ||
      !videoRef.current ||
      !captureCanvasRef.current
    ) {
      return;
    }
    if (!online) {
      setMessage("Capture paused while offline. No image was taken.");
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
      await api.getServerTime();
      const capturedAt = new Date();
      const frames = await captureBurst(
        streamRef.current,
        videoRef.current,
        captureCanvasRef.current,
        4,
        250,
      );
      burst = { id: crypto.randomUUID(), capturedAt, frames };
      setPending(burst);
      lastCaptureAtRef.current = Date.now();
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
  }, [api, busy, facility, online, processBurst, station, streamRef, videoRef]);

  const retryPending = useCallback(async () => {
    if (!pending || busy || !online) return;
    setBusy(true);
    setMessage(null);
    setSaveNotice(null);
    try {
      await api.getServerTime();
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
  }, [api, busy, online, pending, processBurst]);

  useEffect(() => {
    if (!armed) return;
    let frame = 0;
    let lastSample = 0;
    const loop = (timestamp: number) => {
      if (
        timestamp - lastSample >= 120 &&
        videoRef.current &&
        motionCanvasRef.current &&
        !busy
      ) {
        lastSample = timestamp;
        const sample = detectorRef.current.sample(
          videoRef.current,
          motionCanvasRef.current,
          region,
        );
        if (sample.moving) {
          motionSeenAtRef.current ??= Date.now();
          setMotionState("moving");
        } else if (motionSeenAtRef.current) {
          setMotionState("stabilizing");
          const stableFor = Date.now() - motionSeenAtRef.current;
          const cooldownElapsed = Date.now() - lastCaptureAtRef.current > 15_000;
          if (stableFor >= 650 && cooldownElapsed) {
            motionSeenAtRef.current = null;
            void captureNow();
          }
        } else {
          setMotionState("watching");
        }
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [armed, busy, captureNow, videoRef]);

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
          <p>Capture immediately; recognition never blocks the lane.</p>
        </div>
        <div className="header-status">
          <StatusChip tone={online ? "good" : "danger"}>{online ? "Online" : "Offline"}</StatusChip>
          <StatusChip tone={heartbeat === "healthy" ? "good" : heartbeat === "stale" ? "danger" : "neutral"}>
            Heartbeat {heartbeat}
          </StatusChip>
          <StatusChip tone={armed ? "warn" : "neutral"}>{armed ? "Armed" : "Disarmed"}</StatusChip>
        </div>
      </header>

      {message && <div className="error-panel" role="alert">{message}</div>}
      {saveNotice && <div className="success-panel" role="status">{saveNotice}</div>}
      {captureResult && terminalNeedsReview.has(captureResult.status) && (
        <div className="review-warning" role="status">
          This result needs human review. It cannot create an unregistered-vehicle alert.
        </div>
      )}

      <section className="station-grid">
        <div className="camera-panel">
          <div className="camera-viewport">
            <video ref={videoRef} muted playsInline aria-label="Live gate camera" />
            <div className="plate-region" aria-hidden="true">
              <span>ALIGN PLATE</span>
            </div>
            <div className="camera-overlay">
              <span>{station?.direction ?? "SELECT DIRECTION"}</span>
              <span>{motionState.toUpperCase()}</span>
            </div>
          </div>
          <canvas ref={captureCanvasRef} hidden />
          <canvas ref={motionCanvasRef} hidden />
          <div className="camera-actions">
            <div className="camera-source-picker">
              <label htmlFor="camera-source">Camera source</label>
              <div className="camera-source-row">
                <select
                  id="camera-source"
                  value={cameraDeviceId}
                  onChange={(event) => void selectCamera(event.target.value)}
                  disabled={armed || cameraPermission === "requesting"}
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
                  disabled={armed || cameraPermission === "requesting"}
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
                <>
                  <button
                    type="button"
                    className="capture-button"
                    disabled={busy || !online || !facility || !station}
                    onClick={() => void captureNow()}
                  >
                    {busy
                      ? "Capturing / uploading…"
                      : !online
                        ? "Waiting for network"
                        : !facility || !station
                          ? "Select a station to capture"
                          : "Capture now"}
                  </button>
                  <button
                    type="button"
                    className={armed ? "danger-button" : "secondary-button"}
                    onClick={() => (armed ? disarm() : void arm())}
                  >
                    {armed ? "Disarm automatic capture" : "Arm automatic capture"}
                  </button>
                </>
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
                disabled={armed || pending !== null}
              >
                <option value="">Select facility</option>
                {facilities.map((item) => <option key={item.recordId} value={item.recordId}>{item.name}</option>)}
              </select>
            </label>
            <label>
              Logical gate
              <select
                value={stationId}
                onChange={(event) => setStationId(event.target.value)}
                disabled={armed || pending !== null}
              >
                <option value="">Select station</option>
                {stations.map((item) => <option key={item.recordId} value={item.recordId}>{item.name} · {item.direction}</option>)}
              </select>
            </label>
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

          <section className="control-card privacy-card">
            <h2>Privacy & capture</h2>
            <label className="checkbox-label">
              <input type="checkbox" checked={privacyAccepted} onChange={(event) => setPrivacyAccepted(event.target.checked)} />
              <span>
                I understand this station captures vehicle images and license plates for authorized
                facility operations. It performs no facial recognition or person identification.
              </span>
            </label>
            <p className="fine-print">
              Frames remain in memory until upload and are not intentionally written to browser
              storage. Unuploaded frames are lost if the page, computer, or network fails.
            </p>
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

          {captureResult && (
            <section className="control-card result-card" aria-live="polite">
              <h2>Latest capture</h2>
              <StatusChip tone={captureResult.status === "RECOGNIZED" ? "good" : captureResult.status === "FAILED" ? "danger" : "warn"}>
                {captureResult.status.replaceAll("_", " ")}
              </StatusChip>
              <p>Capture {captureResult.recordId}</p>
            </section>
          )}
        </aside>
      </section>
    </div>
  );
}
