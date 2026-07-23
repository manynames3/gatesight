import type { MotionSample } from "./types";

export class MotionDetector {
  private previous: Uint8ClampedArray | null = null;

  constructor(
    private readonly width = 96,
    private readonly height = 40,
    private readonly pixelDelta = 26,
    private readonly threshold = 0.12,
  ) {}

  sample(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    region: { x: number; y: number; width: number; height: number },
  ): MotionSample {
    canvas.width = this.width;
    canvas.height = this.height;
    const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!context || !video.videoWidth) return { changedRatio: 0, moving: false };
    context.drawImage(
      video,
      video.videoWidth * region.x,
      video.videoHeight * region.y,
      video.videoWidth * region.width,
      video.videoHeight * region.height,
      0,
      0,
      this.width,
      this.height,
    );
    const current = context.getImageData(0, 0, this.width, this.height).data;
    let changed = 0;
    if (this.previous) {
      for (let index = 0; index < current.length; index += 4) {
        const luminance =
          current[index]! * 0.299 + current[index + 1]! * 0.587 + current[index + 2]! * 0.114;
        const prior =
          this.previous[index]! * 0.299 +
          this.previous[index + 1]! * 0.587 +
          this.previous[index + 2]! * 0.114;
        if (Math.abs(luminance - prior) >= this.pixelDelta) changed += 1;
      }
    }
    this.previous = new Uint8ClampedArray(current);
    context.clearRect(0, 0, this.width, this.height);
    const changedRatio = changed / (this.width * this.height);
    return { changedRatio, moving: changedRatio >= this.threshold };
  }

  reset() {
    this.previous = null;
  }
}
