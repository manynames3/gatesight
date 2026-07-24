import {
  analyzePlatePixels,
  burstResemblesPlate,
  type PlateAssessment,
} from "./plateGate";
import { describe, expect, it } from "vitest";

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
    contrast: 0,
    edgeDensity: 0,
    verticalEdgeDensity: 0,
    horizontalEdgeDensity: 0,
    strokeGroups: 0,
    occupiedSectors: 0,
  };
}

describe("plate likeness gate", () => {
  it("accepts a wide, contrasting sequence of alphanumeric-like glyphs", () => {
    const target = syntheticPlate();
    const result = analyzePlatePixels(target.pixels, target.width, target.height);
    expect(result.likelyPlate).toBe(true);
    expect(result.strokeGroups).toBeGreaterThanOrEqual(4);
    expect(result.occupiedSectors).toBeGreaterThanOrEqual(3);
  });

  it("rejects a blank region", () => {
    const target = image();
    expect(analyzePlatePixels(target.pixels, target.width, target.height).likelyPlate).toBe(false);
  });

  it("rejects vertical stripes without letter-like horizontal structure", () => {
    const target = image();
    for (let x = 8; x < target.width; x += 16) rectangle(target, x, 5, 3, 70, 30);
    const result = analyzePlatePixels(target.pixels, target.width, target.height);
    expect(result.horizontalEdgeDensity).toBeLessThan(0.012);
    expect(result.likelyPlate).toBe(false);
  });

  it("requires plate-like evidence in at least half of a four-frame burst", () => {
    expect(
      burstResemblesPlate([
        assessment(true),
        assessment(false),
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
  });
});
