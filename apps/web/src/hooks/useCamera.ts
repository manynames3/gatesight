import { useCallback, useEffect, useRef, useState } from "react";
import type { CameraPermission } from "../camera/types";

const constraints = (deviceId?: string): MediaStreamConstraints => ({
  audio: false,
  video: {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    facingMode: { ideal: "environment" },
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  },
});

function permissionFromError(error: unknown): CameraPermission {
  if (!(error instanceof DOMException)) return "unreadable";
  if (["NotAllowedError", "SecurityError"].includes(error.name)) return "denied";
  if (["NotFoundError", "DevicesNotFoundError"].includes(error.name)) return "missing";
  return "unreadable";
}

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const selectedDeviceIdRef = useRef("");
  const hasMediaDevices =
    typeof navigator !== "undefined" && Boolean(navigator.mediaDevices);
  const [permission, setPermission] = useState<CameraPermission>(
    hasMediaDevices ? "idle" : "missing",
  );
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [resolution, setResolution] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(
    hasMediaDevices ? null : "This browser does not expose the required camera APIs.",
  );

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setResolution(null);
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const refreshDevices = useCallback(async () => {
    const mediaDevices = await navigator.mediaDevices.enumerateDevices();
    setDevices(mediaDevices.filter((device) => device.kind === "videoinput"));
  }, []);

  const start = useCallback(
    async (deviceId?: string) => {
      setPermission("requesting");
      setError(null);
      stop();
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints(deviceId));
        const [track] = stream.getVideoTracks();
        if (!track) throw new DOMException("No camera track", "NotFoundError");
        track.addEventListener("ended", () => {
          setPermission("disconnected");
          setError("The selected camera disconnected.");
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        const settings = track.getSettings();
        const width = settings.width ?? videoRef.current?.videoWidth ?? 0;
        const height = settings.height ?? videoRef.current?.videoHeight ?? 0;
        setResolution(width > 0 && height > 0 ? { width, height } : null);
        setPermission("granted");
        const selected = settings.deviceId ?? deviceId ?? "";
        selectedDeviceIdRef.current = selected;
        setSelectedDeviceId(selected);
        await refreshDevices();
      } catch (caught) {
        setPermission(permissionFromError(caught));
        setError(
          caught instanceof DOMException || caught instanceof Error
            ? caught.message
            : "Camera could not be opened",
        );
      }
    },
    [refreshDevices, stop],
  );

  useEffect(() => {
    if (!navigator.mediaDevices) return;
    const changed = async () => {
      const mediaDevices = await navigator.mediaDevices.enumerateDevices();
      const cameras = mediaDevices.filter((device) => device.kind === "videoinput");
      setDevices(cameras);
      const selected = selectedDeviceIdRef.current;
      const selectedStillExists = cameras.some(
        (device) => device.deviceId === selected,
      );
      if (selected && !selectedStillExists) setPermission("disconnected");
    };
    const deviceChangeListener = () => void changed();
    navigator.mediaDevices.addEventListener("devicechange", deviceChangeListener);
    return () => {
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        deviceChangeListener,
      );
      stop();
    };
  }, [stop]);

  return {
    videoRef,
    streamRef,
    permission,
    devices,
    selectedDeviceId,
    resolution,
    lowResolution:
      resolution !== null &&
      (resolution.width < 1280 || resolution.height < 720),
    error,
    start,
    stop,
    select: (deviceId: string) => {
      selectedDeviceIdRef.current = deviceId;
      setSelectedDeviceId(deviceId);
      void start(deviceId);
    },
  };
}
