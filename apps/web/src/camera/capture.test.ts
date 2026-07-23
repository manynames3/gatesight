import { captureBurst, takePhoto } from "./capture";
import { afterEach, describe, expect, it, vi } from "vitest";

const track = {} as MediaStreamTrack;
const stream = { getVideoTracks: () => [track] } as unknown as MediaStream;

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, "ImageCapture");
});

describe("captureBurst", () => {
  it("rejects a burst outside the controlled 3-to-5 range", async () => {
    await expect(
      captureBurst({} as MediaStream, document.createElement("video"), document.createElement("canvas"), 2),
    ).rejects.toThrow("3 to 5");
  });

  it("uses ImageCapture when a JPEG photo is available", async () => {
    const expected = new Blob(["jpeg"], { type: "image/jpeg" });
    class ImageCapture {
      takePhoto() {
        return Promise.resolve(expected);
      }
    }
    (window as unknown as { ImageCapture?: unknown }).ImageCapture = ImageCapture;
    await expect(
      takePhoto(stream, document.createElement("video"), document.createElement("canvas")),
    ).resolves.toBe(expected);
  });

  it("falls back to canvas and clears pixels", async () => {
    const video = document.createElement("video");
    Object.defineProperty(video, "videoWidth", { value: 640 });
    Object.defineProperty(video, "videoHeight", { value: 480 });
    const canvas = document.createElement("canvas");
    const context = { drawImage: vi.fn(), clearRect: vi.fn() };
    vi.spyOn(canvas, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    canvas.toBlob = (callback) => callback(new Blob(["jpeg"], { type: "image/jpeg" }));
    const result = await takePhoto(stream, video, canvas);
    expect(result.type).toBe("image/jpeg");
    expect(context.drawImage).toHaveBeenCalledOnce();
    expect(context.clearRect).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(1);
  });

  it("captures the requested burst with controlled spacing", async () => {
    vi.useFakeTimers();
    class ImageCapture {
      takePhoto() {
        return Promise.resolve(new Blob(["jpeg"], { type: "image/jpeg" }));
      }
    }
    (window as unknown as { ImageCapture?: unknown }).ImageCapture = ImageCapture;
    const promise = captureBurst(
      stream,
      document.createElement("video"),
      document.createElement("canvas"),
      3,
      250,
    );
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toHaveLength(3);
  });
});
