export interface NormalizedRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlateAssessment {
  likelyPlate: boolean;
  evidence: "strong" | "possible" | "none";
  evidenceScore: number;
  qualityScore: number;
  contrast: number;
  meanLuminance: number;
  darkRatio: number;
  glareRatio: number;
  edgeDensity: number;
  verticalEdgeDensity: number;
  horizontalEdgeDensity: number;
  strokeGroups: number;
  occupiedSectors: number;
  rectangleScore: number;
}

const SAMPLE_WIDTH = 192;
const SAMPLE_HEIGHT = 80;
const EDGE_THRESHOLD = 80;
const SECTOR_COUNT = 6;
const RECTANGLE_THRESHOLD = 0.45;
const SIDE_TOLERANCE = 2;
const SIDE_GAP_TOLERANCE = 2;

function coherentLineSupport(samples: boolean[]): number {
  if (samples.length === 0) return 0;
  const coverage = samples.filter(Boolean).length / samples.length;
  let longestRun = 0;
  let run = 0;
  let gap = 0;
  for (const supported of samples) {
    if (supported) {
      run += gap + 1;
      gap = 0;
      longestRun = Math.max(longestRun, run);
    } else if (run > 0 && gap < SIDE_GAP_TOLERANCE) {
      gap += 1;
    } else {
      run = 0;
      gap = 0;
    }
  }
  return Math.min(coverage, longestRun / samples.length);
}

function horizontalSideSupport(
  gradients: Float32Array,
  width: number,
  height: number,
  startRow: number,
  endRow: number,
): number {
  const startX = Math.max(1, Math.round(width * 0.04));
  const endX = Math.min(width - 1, Math.round(width * 0.96));
  let maximum = 0;
  for (let row = Math.max(1, startRow); row < Math.min(height - 1, endRow); row += 1) {
    const samples: boolean[] = [];
    for (let x = startX; x < endX; x += 1) {
      let found = false;
      for (let offset = -SIDE_TOLERANCE; offset <= SIDE_TOLERANCE; offset += 1) {
        const y = row + offset;
        if (y > 0 && y < height - 1 && gradients[y * width + x]! >= EDGE_THRESHOLD) {
          found = true;
          break;
        }
      }
      samples.push(found);
    }
    maximum = Math.max(maximum, coherentLineSupport(samples));
  }
  return maximum;
}

function verticalSideSupport(
  gradients: Float32Array,
  width: number,
  height: number,
  startColumn: number,
  endColumn: number,
): number {
  const startY = Math.max(1, Math.round(height * 0.075));
  const endY = Math.min(height - 1, Math.round(height * 0.925));
  let maximum = 0;
  for (
    let column = Math.max(1, startColumn);
    column < Math.min(width - 1, endColumn);
    column += 1
  ) {
    const samples: boolean[] = [];
    for (let y = startY; y < endY; y += 1) {
      let found = false;
      for (let offset = -SIDE_TOLERANCE; offset <= SIDE_TOLERANCE; offset += 1) {
        const x = column + offset;
        if (x > 0 && x < width - 1 && gradients[y * width + x]! >= EDGE_THRESHOLD) {
          found = true;
          break;
        }
      }
      samples.push(found);
    }
    maximum = Math.max(maximum, coherentLineSupport(samples));
  }
  return maximum;
}

export function analyzePlatePixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): PlateAssessment {
  if (width < 3 || height < 3 || pixels.length !== width * height * 4) {
    return {
      likelyPlate: false,
      evidence: "none",
      evidenceScore: 0,
      qualityScore: 0,
      contrast: 0,
      meanLuminance: 0,
      darkRatio: 0,
      glareRatio: 0,
      edgeDensity: 0,
      verticalEdgeDensity: 0,
      horizontalEdgeDensity: 0,
      strokeGroups: 0,
      occupiedSectors: 0,
      rectangleScore: 0,
    };
  }

  const luminance = new Float32Array(width * height);
  let luminanceTotal = 0;
  let darkPixels = 0;
  let glarePixels = 0;
  for (let pixel = 0, offset = 0; pixel < luminance.length; pixel += 1, offset += 4) {
    const value =
      pixels[offset]! * 0.299 + pixels[offset + 1]! * 0.587 + pixels[offset + 2]! * 0.114;
    luminance[pixel] = value;
    luminanceTotal += value;
    darkPixels += Number(value <= 25);
    glarePixels += Number(value >= 245);
  }

  const mean = luminanceTotal / luminance.length;
  let squaredDifference = 0;
  for (const value of luminance) squaredDifference += (value - mean) ** 2;
  const contrast = Math.sqrt(squaredDifference / luminance.length);

  const columnVerticalEdges = new Uint16Array(width);
  const sectorVerticalEdges = new Uint32Array(SECTOR_COUNT);
  const rowEdges = new Uint16Array(height);
  const absoluteGradientX = new Float32Array(width * height);
  const absoluteGradientY = new Float32Array(width * height);
  let edges = 0;
  let verticalEdges = 0;
  let horizontalEdges = 0;
  const interiorPixels = (width - 2) * (height - 2);
  const textStartY = Math.floor(height * 0.12);
  const textEndY = Math.ceil(height * 0.88);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const top = (y - 1) * width;
      const middle = y * width;
      const bottom = (y + 1) * width;
      const gradientX =
        -luminance[top + x - 1]! +
        luminance[top + x + 1]! -
        2 * luminance[middle + x - 1]! +
        2 * luminance[middle + x + 1]! -
        luminance[bottom + x - 1]! +
        luminance[bottom + x + 1]!;
      const gradientY =
        -luminance[top + x - 1]! -
        2 * luminance[top + x]! -
        luminance[top + x + 1]! +
        luminance[bottom + x - 1]! +
        2 * luminance[bottom + x]! +
        luminance[bottom + x + 1]!;
      const absoluteX = Math.abs(gradientX);
      const absoluteY = Math.abs(gradientY);
      absoluteGradientX[middle + x] = absoluteX;
      absoluteGradientY[middle + x] = absoluteY;

      if (Math.hypot(absoluteX, absoluteY) >= EDGE_THRESHOLD) {
        edges += 1;
        rowEdges[y] = rowEdges[y]! + 1;
      }
      if (absoluteX >= EDGE_THRESHOLD) {
        verticalEdges += 1;
        if (y >= textStartY && y < textEndY) {
          columnVerticalEdges[x] = columnVerticalEdges[x]! + 1;
          const sector = Math.min(SECTOR_COUNT - 1, Math.floor((x * SECTOR_COUNT) / width));
          sectorVerticalEdges[sector] = sectorVerticalEdges[sector]! + 1;
        }
      }
      if (absoluteY >= EDGE_THRESHOLD && y >= textStartY && y < textEndY) {
        horizontalEdges += 1;
      }
    }
  }

  const textBandHeight = textEndY - textStartY;
  const activeColumnMinimum = Math.max(2, Math.ceil(textBandHeight * 0.14));
  let strokeGroups = 0;
  let groupWidth = 0;
  for (let x = 1; x < width - 1; x += 1) {
    if (columnVerticalEdges[x]! >= activeColumnMinimum) {
      groupWidth += 1;
    } else if (groupWidth > 0) {
      if (groupWidth <= Math.ceil(width * 0.1)) strokeGroups += 1;
      groupWidth = 0;
    }
  }
  if (groupWidth > 0 && groupWidth <= Math.ceil(width * 0.1)) strokeGroups += 1;

  const sectorWidth = width / SECTOR_COUNT;
  const sectorMinimum = textBandHeight * sectorWidth * 0.012;
  const occupiedSectors = Array.from(
    sectorVerticalEdges,
    (value) => value >= sectorMinimum,
  ).filter(Boolean).length;
  const peakRowEdgeRatio = Math.max(...rowEdges) / Math.max(1, width - 2);
  const edgeDensity = edges / interiorPixels;
  const verticalEdgeDensity = verticalEdges / interiorPixels;
  const horizontalEdgeDensity =
    horizontalEdges / Math.max(1, (width - 2) * textBandHeight);
  const sideSupports = [
    horizontalSideSupport(
      absoluteGradientY,
      width,
      height,
      2,
      Math.round(height * 0.31),
    ),
    horizontalSideSupport(
      absoluteGradientY,
      width,
      height,
      Math.round(height * 0.69),
      height - 2,
    ),
    verticalSideSupport(
      absoluteGradientX,
      width,
      height,
      2,
      Math.round(width * 0.25),
    ),
    verticalSideSupport(
      absoluteGradientX,
      width,
      height,
      Math.round(width * 0.75),
      width - 2,
    ),
  ].sort((left, right) => right - left);
  const rectangleScore = sideSupports[2] ?? 0;

  const strongPlate =
    contrast >= 18 &&
    edgeDensity >= 0.025 &&
    verticalEdgeDensity >= 0.018 &&
    horizontalEdgeDensity >= 0.012 &&
    strokeGroups >= 4 &&
    strokeGroups <= 48 &&
    occupiedSectors >= 3 &&
    peakRowEdgeRatio >= 0.08 &&
    rectangleScore >= RECTANGLE_THRESHOLD;
  const possiblePlate =
    contrast >= 10 &&
    edgeDensity >= 0.012 &&
    verticalEdgeDensity >= 0.009 &&
    horizontalEdgeDensity >= 0.006 &&
    strokeGroups >= 3 &&
    strokeGroups <= 56 &&
    occupiedSectors >= 2 &&
    peakRowEdgeRatio >= 0.045;
  const evidence = strongPlate ? "strong" : possiblePlate ? "possible" : "none";
  const evidenceScore = [
    contrast >= 10,
    edgeDensity >= 0.012,
    verticalEdgeDensity >= 0.009,
    horizontalEdgeDensity >= 0.006,
    strokeGroups >= 3 && strokeGroups <= 56,
    occupiedSectors >= 2,
    peakRowEdgeRatio >= 0.045,
    rectangleScore >= RECTANGLE_THRESHOLD,
  ].filter(Boolean).length;
  const darkRatio = darkPixels / luminance.length;
  const glareRatio = glarePixels / luminance.length;
  const qualityScore =
    evidenceScore * 10 +
    Math.min(20, contrast / 2) +
    Math.min(12, edgeDensity * 200) +
    Math.min(8, occupiedSectors) -
    (1 - rectangleScore) * 12 -
    darkRatio * 20 -
    glareRatio * 25;

  return {
    likelyPlate: evidence !== "none",
    evidence,
    evidenceScore,
    qualityScore,
    contrast,
    meanLuminance: mean,
    darkRatio,
    glareRatio,
    edgeDensity,
    verticalEdgeDensity,
    horizontalEdgeDensity,
    strokeGroups,
    occupiedSectors,
    rectangleScore,
  };
}

function assessSource(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  canvas: HTMLCanvasElement,
  region: NormalizedRegion,
): PlateAssessment {
  canvas.width = SAMPLE_WIDTH;
  canvas.height = SAMPLE_HEIGHT;
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!context || !sourceWidth || !sourceHeight) {
    throw new Error("Camera frame cannot be inspected locally");
  }
  try {
    context.drawImage(
      source,
      sourceWidth * region.x,
      sourceHeight * region.y,
      sourceWidth * region.width,
      sourceHeight * region.height,
      0,
      0,
      SAMPLE_WIDTH,
      SAMPLE_HEIGHT,
    );
    return analyzePlatePixels(
      context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data,
      SAMPLE_WIDTH,
      SAMPLE_HEIGHT,
    );
  } finally {
    context.clearRect(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    canvas.width = 1;
    canvas.height = 1;
  }
}

export async function assessCapturedPlate(
  frame: Blob,
  canvas: HTMLCanvasElement,
  region: NormalizedRegion,
): Promise<PlateAssessment> {
  const bitmap = await createImageBitmap(frame);
  try {
    return assessSource(bitmap, bitmap.width, bitmap.height, canvas, region);
  } finally {
    bitmap.close();
  }
}

export function assessLivePlate(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  region: NormalizedRegion,
): PlateAssessment {
  return assessSource(video, video.videoWidth, video.videoHeight, canvas, region);
}

export type LivePlateCheckResult =
  | { assessment: PlateAssessment; error: null }
  | { assessment: null; error: string };

export function tryAssessLivePlate(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  region: NormalizedRegion,
): LivePlateCheckResult {
  try {
    return { assessment: assessLivePlate(video, canvas, region), error: null };
  } catch (error) {
    return {
      assessment: null,
      error: error instanceof Error ? error.message : "Camera frame cannot be inspected locally",
    };
  }
}

export function shouldStartAutomaticCapture(assessment: PlateAssessment): boolean {
  return assessment.evidence === "strong";
}

export function burstResemblesPlate(assessments: PlateAssessment[]): boolean {
  if (assessments.length === 0) return false;
  const strongFrames = assessments.filter((assessment) => assessment.evidence === "strong").length;
  return strongFrames >= 3;
}

export function selectBestFrameIndices(
  assessments: PlateAssessment[],
  maximum = 4,
): number[] {
  return assessments
    .map((assessment, index) => ({ assessment, index }))
    .filter(({ assessment }) => assessment.evidence === "strong")
    .sort((left, right) => {
      const evidenceOrder = { strong: 2, possible: 1, none: 0 } as const;
      return (
        evidenceOrder[right.assessment.evidence] -
          evidenceOrder[left.assessment.evidence] ||
        right.assessment.qualityScore - left.assessment.qualityScore ||
        left.index - right.index
      );
    })
    .slice(0, maximum)
    .map(({ index }) => index)
    .sort((left, right) => left - right);
}

export function captureGuidance(assessments: PlateAssessment[]): string {
  if (assessments.length === 0) return "Wait for the camera and try again.";
  const average = (field: keyof PlateAssessment) =>
    assessments.reduce((total, item) => total + Number(item[field]), 0) /
    assessments.length;
  if (average("meanLuminance") < 55 || average("darkRatio") > 0.35) {
    return "Add light to the plate and try again.";
  }
  if (average("glareRatio") > 0.18) {
    return "Tilt the plate or light slightly to reduce glare.";
  }
  if (average("rectangleScore") < RECTANGLE_THRESHOLD) {
    return "Center the full rectangular plate inside the guide.";
  }
  if (average("occupiedSectors") < 2.5 || average("strokeGroups") < 3) {
    return "Move the plate closer and keep its characters inside the guide.";
  }
  if (average("horizontalEdgeDensity") < 0.006) {
    return "Hold the plate flat, level, and steady inside the guide.";
  }
  return "Hold the plate steady inside the guide and try again.";
}
