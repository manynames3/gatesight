import { MotionDetector, MotionStabilityTracker } from "./motion";
import { describe, expect, it, vi } from "vitest";

describe("MotionDetector", () => {
  it("starts without declaring motion", () => {
    const detector = new MotionDetector();
    const canvas = document.createElement("canvas");
    const context = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(96 * 40 * 4) })),
      clearRect: vi.fn(),
    };
    vi.spyOn(canvas, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const video = document.createElement("video");
    Object.defineProperty(video, "videoWidth", { value: 1920 });
    Object.defineProperty(video, "videoHeight", { value: 1080 });
    expect(detector.sample(video, canvas, { x: 0, y: 0, width: 1, height: 1 })).toEqual({
      changedRatio: 0,
      moving: false,
    });
  });

  it("detects changed pixels and resets history", () => {
    const detector = new MotionDetector(2, 2, 10, 0.2);
    const canvas = document.createElement("canvas");
    const dark = new Uint8ClampedArray(2 * 2 * 4);
    const light = new Uint8ClampedArray(2 * 2 * 4).fill(255);
    const context = {
      drawImage: vi.fn(),
      getImageData: vi
        .fn()
        .mockReturnValueOnce({ data: dark })
        .mockReturnValueOnce({ data: light })
        .mockReturnValueOnce({ data: light }),
      clearRect: vi.fn(),
    };
    vi.spyOn(canvas, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const video = document.createElement("video");
    Object.defineProperty(video, "videoWidth", { value: 100 });
    Object.defineProperty(video, "videoHeight", { value: 100 });
    const area = { x: 0, y: 0, width: 1, height: 1 };
    expect(detector.sample(video, canvas, area).moving).toBe(false);
    expect(detector.sample(video, canvas, area).moving).toBe(true);
    detector.reset();
    expect(detector.sample(video, canvas, area).moving).toBe(false);
  });
});

describe("MotionStabilityTracker", () => {
  it("waits for a complete stable period after motion stops", () => {
    const tracker = new MotionStabilityTracker(650);

    expect(tracker.update(true, 1_000)).toEqual({
      state: "moving",
      shouldCapture: false,
    });
    expect(tracker.update(true, 2_000)).toEqual({
      state: "moving",
      shouldCapture: false,
    });
    expect(tracker.update(false, 2_050)).toEqual({
      state: "stabilizing",
      shouldCapture: false,
    });
    expect(tracker.update(false, 2_699)).toEqual({
      state: "stabilizing",
      shouldCapture: false,
    });
    expect(tracker.update(false, 2_700)).toEqual({
      state: "stabilizing",
      shouldCapture: true,
    });
    expect(tracker.update(false, 10_000).shouldCapture).toBe(true);
    tracker.reset();
    expect(tracker.update(false, 10_001).shouldCapture).toBe(false);
  });

  it("restarts stabilization when motion resumes", () => {
    const tracker = new MotionStabilityTracker(650);

    tracker.update(true, 0);
    tracker.update(false, 100);
    expect(tracker.update(true, 500).state).toBe("moving");
    expect(tracker.update(false, 600).shouldCapture).toBe(false);
    expect(tracker.update(false, 1_249).shouldCapture).toBe(false);
    expect(tracker.update(false, 1_250).shouldCapture).toBe(true);
    expect(tracker.update(false, 1_900).shouldCapture).toBe(true);
  });

  it("does not capture a scene that never moved", () => {
    const tracker = new MotionStabilityTracker(650);

    expect(tracker.update(false, 0)).toEqual({
      state: "watching",
      shouldCapture: false,
    });
    expect(tracker.update(false, 10_000).shouldCapture).toBe(false);
  });
});
