import { describe, expect, it } from "vitest";
import { coverOverlayRegion } from "./region";

function pixelAspect(
  region: NonNullable<ReturnType<typeof coverOverlayRegion>>,
  sourceWidth: number,
  sourceHeight: number,
) {
  return (region.width * sourceWidth) / (region.height * sourceHeight);
}

describe("coverOverlayRegion", () => {
  it("preserves a 2:1 guide over a cropped 16:9 camera stream", () => {
    const region = coverOverlayRegion(
      { width: 1920, height: 1080 },
      { width: 1600, height: 1000 },
      { x: 528, y: 520, width: 544, height: 272 },
    );

    expect(region).not.toBeNull();
    expect(pixelAspect(region!, 1920, 1080)).toBeCloseTo(2, 6);
  });

  it("preserves the same guide ratio for a 4:3 camera", () => {
    const region = coverOverlayRegion(
      { width: 1280, height: 960 },
      { width: 1600, height: 1000 },
      { x: 528, y: 520, width: 544, height: 272 },
    );

    expect(region).not.toBeNull();
    expect(pixelAspect(region!, 1280, 960)).toBeCloseTo(2, 6);
  });

  it("waits until the camera and guide have measurable dimensions", () => {
    expect(
      coverOverlayRegion(
        { width: 0, height: 0 },
        { width: 1600, height: 1000 },
        { x: 528, y: 520, width: 544, height: 272 },
      ),
    ).toBeNull();
  });
});
