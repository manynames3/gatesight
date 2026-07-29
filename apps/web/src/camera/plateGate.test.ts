import {
  analyzePlatePixels,
  assessLivePlate,
  burstResemblesPlate,
  captureGuidance,
  selectBestFrameIndices,
  shouldStartAutomaticCapture,
  tryAssessLivePlate,
  type PlateAssessment,
} from "./plateGate";
import { describe, expect, it, vi } from "vitest";

function image(width = 192, height = 80, value = 220) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = value;
    pixels[offset + 1] = value;
    pixels[offset + 2] = value;
    pixels[offset + 3] = 255;
  }
  return { pixels, width, height };
}

function rectangle(
  target: ReturnType<typeof image>,
  x: number,
  y: number,
  width: number,
  height: number,
  value: number,
) {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      const offset = (row * target.width + column) * 4;
      target.pixels[offset] = value;
      target.pixels[offset + 1] = value;
      target.pixels[offset + 2] = value;
    }
  }
}

function syntheticPlate() {
  const target = image();
  rectangle(target, 5, 7, 182, 2, 45);
  rectangle(target, 5, 70, 182, 2, 45);
  rectangle(target, 5, 7, 2, 65, 45);
  rectangle(target, 185, 7, 2, 65, 45);
  for (let character = 0; character < 7; character += 1) {
    const x = 20 + character * 23;
    rectangle(target, x, 22, 3, 35, 35);
    rectangle(target, x + 11, 22, 3, 35, 35);
    rectangle(target, x, 22, 14, 3, 35);
    rectangle(target, x, 37, 14, 3, 35);
    rectangle(target, x, 54, 14, 3, 35);
  }
  return target;
}

function denseClosePlate() {
  const target = image();
  rectangle(target, 3, 3, 186, 4, 35);
  rectangle(target, 3, 73, 186, 4, 35);
  rectangle(target, 3, 3, 4, 74, 35);
  rectangle(target, 185, 3, 4, 74, 35);
  for (let character = 0; character < 9; character += 1) {
    const x = 7 + character * 20;
    rectangle(target, x, 10, 4, 58, 25);
    rectangle(target, x + 12, 10, 4, 58, 25);
    for (const y of [10, 22, 34, 46, 58, 64]) {
      rectangle(target, x, y, 16, 4, 25);
    }
  }
  return target;
}

function characterTextureWithoutPlateBoundary() {
  const target = image();
  for (let character = 0; character < 7; character += 1) {
    const x = 20 + character * 23;
    rectangle(target, x, 22, 3, 35, 35);
    rectangle(target, x + 11, 22, 3, 35, 35);
    rectangle(target, x, 22, 14, 3, 35);
    rectangle(target, x, 37, 14, 3, 35);
    rectangle(target, x, 54, 14, 3, 35);
  }
  return target;
}

function assessment(likelyPlate: boolean): PlateAssessment {
  return {
    likelyPlate,
    evidence: likelyPlate ? "strong" : "none",
    evidenceScore: likelyPlate ? 7 : 0,
    qualityScore: likelyPlate ? 80 : 0,
    contrast: 0,
    meanLuminance: 120,
    darkRatio: 0,
    glareRatio: 0,
    edgeDensity: 0,
    verticalEdgeDensity: 0,
    horizontalEdgeDensity: 0,
    strokeGroups: 0,
    occupiedSectors: 0,
    rectangleScore: likelyPlate ? 0.8 : 0,
  };
}

describe("plate likeness gate", () => {
  it("accepts a wide, contrasting sequence of alphanumeric-like glyphs", () => {
    const target = syntheticPlate();
    const result = analyzePlatePixels(target.pixels, target.width, target.height);
    expect(result.likelyPlate).toBe(true);
    expect(result.strokeGroups).toBeGreaterThanOrEqual(4);
    expect(result.occupiedSectors).toBeGreaterThanOrEqual(3);
    expect(result.rectangleScore).toBeGreaterThanOrEqual(0.45);
  });

  it("rejects a blank region", () => {
    const target = image();
    expect(analyzePlatePixels(target.pixels, target.width, target.height).likelyPlate).toBe(false);
  });

  it("accepts dense character structure when a plate fills the guide", () => {
    const target = denseClosePlate();
    const result = analyzePlatePixels(target.pixels, target.width, target.height);
    expect(
      Math.max(
        result.edgeDensity / 0.34,
        result.verticalEdgeDensity / 0.26,
        result.horizontalEdgeDensity / 0.28,
      ),
    ).toBeGreaterThan(1);
    expect(result.likelyPlate, JSON.stringify(result)).toBe(true);
  });

  it("rejects vertical stripes without letter-like horizontal structure", () => {
    const target = image();
    for (let x = 8; x < target.width; x += 16) rectangle(target, x, 5, 3, 70, 30);
    const result = analyzePlatePixels(target.pixels, target.width, target.height);
    expect(result.horizontalEdgeDensity).toBeLessThan(0.012);
    expect(result.likelyPlate).toBe(false);
    expect(result.rectangleScore).toBeLessThan(0.45);
  });

  it("rejects character-like scene texture without a plate boundary", () => {
    const target = characterTextureWithoutPlateBoundary();
    const result = analyzePlatePixels(target.pixels, target.width, target.height);
    expect(result.strokeGroups).toBeGreaterThanOrEqual(4);
    expect(result.occupiedSectors).toBeGreaterThanOrEqual(3);
    expect(result.rectangleScore).toBeLessThan(0.45);
    expect(result.evidence).not.toBe("strong");
  });

  it("checks the current guide without retaining or uploading a frame", () => {
    const target = syntheticPlate();
    const drawImage = vi.fn();
    const clearRect = vi.fn();
    const canvas = document.createElement("canvas");
    vi.spyOn(canvas, "getContext").mockReturnValue({
      drawImage,
      clearRect,
      getImageData: vi.fn(() => ({ data: target.pixels })),
    } as unknown as CanvasRenderingContext2D);
    const video = document.createElement("video");
    Object.defineProperty(video, "videoWidth", { value: 1920 });
    Object.defineProperty(video, "videoHeight", { value: 1080 });
    const region = { x: 0.35, y: 0.5, width: 0.3, height: 0.27 };

    const result = assessLivePlate(video, canvas, region);

    expect(result.evidence).toBe("strong");
    expect(drawImage).toHaveBeenCalledWith(
      video,
      672,
      540,
      576,
      291.6,
      0,
      0,
      192,
      80,
    );
    expect(clearRect).toHaveBeenCalled();
  });

  it("returns a recoverable result when the live guide cannot be inspected", () => {
    const canvas = document.createElement("canvas");
    vi.spyOn(canvas, "getContext").mockReturnValue(null);
    const video = document.createElement("video");
    Object.defineProperty(video, "videoWidth", { value: 1920 });
    Object.defineProperty(video, "videoHeight", { value: 1080 });

    expect(
      tryAssessLivePlate(video, canvas, {
        x: 0.35,
        y: 0.5,
        width: 0.3,
        height: 0.27,
      }),
    ).toEqual({
      assessment: null,
      error: "Camera frame cannot be inspected locally",
    });
  });

  it("does not start automatic capture from weak scene texture", () => {
    expect(shouldStartAutomaticCapture(assessment(true))).toBe(true);
    expect(
      shouldStartAutomaticCapture({
        ...assessment(false),
        likelyPlate: true,
        evidence: "possible",
      }),
    ).toBe(false);
    expect(shouldStartAutomaticCapture(assessment(false))).toBe(false);
  });

  it("requires strong plate-like evidence across at least three frames", () => {
    expect(
      burstResemblesPlate([
        assessment(true),
        assessment(true),
        assessment(true),
        assessment(false),
      ]),
    ).toBe(true);
    expect(
      burstResemblesPlate([
        assessment(true),
        assessment(false),
        assessment(false),
        assessment(false),
      ]),
    ).toBe(false);
    expect(
      burstResemblesPlate([
        assessment(true),
        assessment(true),
        { ...assessment(false), likelyPlate: true, evidence: "possible" },
        assessment(false),
      ]),
    ).toBe(false);
    expect(
      burstResemblesPlate([
        { ...assessment(false), likelyPlate: true, evidence: "possible" },
        { ...assessment(false), likelyPlate: true, evidence: "possible" },
        { ...assessment(false), likelyPlate: true, evidence: "possible" },
        { ...assessment(false), likelyPlate: true, evidence: "possible" },
      ]),
    ).toBe(false);
    expect(burstResemblesPlate([assessment(false), assessment(false)])).toBe(false);
  });

  it("keeps only the strongest plate-like frames in their original order", () => {
    const assessments = [
      { ...assessment(true), qualityScore: 60 },
      { ...assessment(false), qualityScore: 20 },
      { ...assessment(true), qualityScore: 90 },
      { ...assessment(true), qualityScore: 70 },
      { ...assessment(true), qualityScore: 80 },
    ];
    expect(selectBestFrameIndices(assessments, 3)).toEqual([2, 3, 4]);
    expect(selectBestFrameIndices(assessments, 4)).toEqual([0, 2, 3, 4]);
  });

  it("never selects weak or empty frames for upload", () => {
    const assessments = [
      { ...assessment(true), qualityScore: 70 },
      {
        ...assessment(false),
        likelyPlate: true,
        evidence: "possible" as const,
        qualityScore: 100,
      },
      { ...assessment(true), qualityScore: 60 },
      { ...assessment(false), qualityScore: 90 },
    ];
    expect(selectBestFrameIndices(assessments, 4)).toEqual([0, 2]);
  });

  it("gives actionable guidance for dark captures", () => {
    expect(
      captureGuidance([
        {
          ...assessment(false),
          meanLuminance: 20,
          darkRatio: 0.8,
        },
      ]),
    ).toContain("light");
  });
});
