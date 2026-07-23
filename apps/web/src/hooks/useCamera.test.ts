import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { useCamera } from "./useCamera";

type TrackFixture = MediaStreamTrack & {
  end: () => void;
  stopCount: () => number;
};
type GetUserMediaMock = Mock<
  (constraints: MediaStreamConstraints) => Promise<MediaStream>
>;

function track(
  settings: MediaTrackSettings = {
    deviceId: "camera-a",
    width: 1920,
    height: 1080,
  },
): TrackFixture {
  let ended: (() => void) | undefined;
  let stops = 0;
  return {
    addEventListener: vi.fn((name: string, listener: EventListenerOrEventListenerObject) => {
      if (name === "ended") {
        ended =
          typeof listener === "function"
            ? () => listener(new Event("ended"))
            : () => listener.handleEvent(new Event("ended"));
      }
    }),
    end: () => ended?.(),
    getSettings: () => settings,
    stop: () => {
      stops += 1;
    },
    stopCount: () => stops,
  } as unknown as TrackFixture;
}

function stream(videoTrack: TrackFixture): MediaStream {
  return {
    getTracks: () => [videoTrack],
    getVideoTracks: () => [videoTrack],
  } as unknown as MediaStream;
}

function device(deviceId: string): MediaDeviceInfo {
  return {
    deviceId,
    groupId: "group",
    kind: "videoinput",
    label: `Camera ${deviceId}`,
    toJSON: () => ({}),
  };
}

function installMediaDevices(
  getUserMedia: GetUserMediaMock,
  cameras: MediaDeviceInfo[] = [],
) {
  let deviceChange: (() => void) | undefined;
  const enumerateDevices = vi.fn().mockResolvedValue(cameras);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      addEventListener: vi.fn((name: string, listener: () => void) => {
        if (name === "devicechange") deviceChange = listener;
      }),
      enumerateDevices,
      getUserMedia,
      removeEventListener: vi.fn(),
    },
  });
  return {
    enumerateDevices,
    triggerDeviceChange: () => deviceChange?.(),
  };
}

describe("useCamera", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("maps permission denial to a recoverable denied state", async () => {
    installMediaDevices(
      vi.fn().mockRejectedValue(new DOMException("Permission denied", "NotAllowedError")),
    );
    const { result } = renderHook(() => useCamera());
    await act(() => result.current.start());
    expect(result.current.permission).toBe("denied");
    expect(result.current.error).toContain("Permission denied");
  });

  it("maps a missing camera to the missing state", async () => {
    installMediaDevices(
      vi.fn().mockRejectedValue(new DOMException("No camera", "NotFoundError")),
    );
    const { result } = renderHook(() => useCamera());
    await act(() => result.current.start());
    expect(result.current.permission).toBe("missing");
    expect(result.current.devices).toEqual([]);
  });

  it("enumerates multiple cameras and selects the active track", async () => {
    const activeTrack = track();
    installMediaDevices(
      vi.fn().mockResolvedValue(stream(activeTrack)),
      [device("camera-a"), device("camera-b")],
    );
    const { result } = renderHook(() => useCamera());
    await act(() => result.current.start());
    expect(result.current.permission).toBe("granted");
    expect(result.current.selectedDeviceId).toBe("camera-a");
    expect(result.current.devices).toHaveLength(2);
  });

  it("switches to the selected physical camera", async () => {
    const firstTrack = track({ deviceId: "camera-a", width: 1920, height: 1080 });
    const secondTrack = track({ deviceId: "camera-b", width: 1920, height: 1080 });
    const getUserMedia = vi
      .fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>()
      .mockResolvedValueOnce(stream(firstTrack))
      .mockResolvedValueOnce(stream(secondTrack));
    installMediaDevices(getUserMedia, [device("camera-a"), device("camera-b")]);
    const { result } = renderHook(() => useCamera());

    await act(() => result.current.start());
    await act(() => result.current.select("camera-b"));

    expect(getUserMedia.mock.lastCall?.[0]).toEqual({
      audio: false,
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        facingMode: { ideal: "environment" },
        deviceId: { exact: "camera-b" },
      },
    });
    expect(firstTrack.stopCount()).toBe(1);
    expect(result.current.selectedDeviceId).toBe("camera-b");
  });

  it("warns on low resolution and surfaces disconnection", async () => {
    const activeTrack = track({
      deviceId: "camera-low",
      width: 640,
      height: 480,
    });
    installMediaDevices(
      vi.fn().mockResolvedValue(stream(activeTrack)),
      [device("camera-low")],
    );
    const { result } = renderHook(() => useCamera());
    await act(() => result.current.start());
    expect(result.current.resolution).toEqual({ width: 640, height: 480 });
    expect(result.current.lowResolution).toBe(true);
    act(() => activeTrack.end());
    expect(result.current.permission).toBe("disconnected");
    expect(result.current.error).toMatch(/disconnected/i);
  });

  it("detects removal of the selected physical camera", async () => {
    const activeTrack = track();
    const media = installMediaDevices(
      vi.fn().mockResolvedValue(stream(activeTrack)),
      [device("camera-a")],
    );
    const { result } = renderHook(() => useCamera());
    await act(() => result.current.start());
    media.enumerateDevices.mockResolvedValue([]);
    await act(async () => {
      media.triggerDeviceChange();
      await Promise.resolve();
    });
    expect(result.current.permission).toBe("disconnected");
    expect(result.current.devices).toEqual([]);
  });
});
