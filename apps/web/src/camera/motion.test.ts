import { MotionDetector } from "./motion";
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
