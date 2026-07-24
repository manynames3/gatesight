export interface NormalizedRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlateAssessment {
  likelyPlate: boolean;
  contrast: number;
  edgeDensity: number;
  verticalEdgeDensity: number;
  horizontalEdgeDensity: number;
  strokeGroups: number;
  occupiedSectors: number;
}

const SAMPLE_WIDTH = 192;
const SAMPLE_HEIGHT = 80;
const EDGE_THRESHOLD = 80;
const SECTOR_COUNT = 6;

export function analyzePlatePixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): PlateAssessment {
  if (width < 3 || height < 3 || pixels.length !== width * height * 4) {
    return {
      likelyPlate: false,
      contrast: 0,
      edgeDensity: 0,
      verticalEdgeDensity: 0,
      horizontalEdgeDensity: 0,
      strokeGroups: 0,
      occupiedSectors: 0,
    };
  }

  const luminance = new Float32Array(width * height);
  let luminanceTotal = 0;
  for (let pixel = 0, offset = 0; pixel < luminance.length; pixel += 1, offset += 4) {
    const value =
      pixels[offset]! * 0.299 + pixels[offset + 1]! * 0.587 + pixels[offset + 2]! * 0.114;
    luminance[pixel] = value;
    luminanceTotal += value;
  }

  const mean = luminanceTotal / luminance.length;
  let squaredDifference = 0;
  for (const value of luminance) squaredDifference += (value - mean) ** 2;
  const contrast = Math.sqrt(squaredDifference / luminance.length);

  const columnVerticalEdges = new Uint16Array(width);
  const sectorVerticalEdges = new Uint32Array(SECTOR_COUNT);
  const rowEdges = new Uint16Array(height);
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

  const likelyPlate =
    contrast >= 18 &&
    edgeDensity >= 0.025 &&
    edgeDensity <= 0.34 &&
    verticalEdgeDensity >= 0.018 &&
    verticalEdgeDensity <= 0.26 &&
    horizontalEdgeDensity >= 0.012 &&
    horizontalEdgeDensity <= 0.28 &&
    strokeGroups >= 4 &&
    strokeGroups <= 28 &&
    occupiedSectors >= 3 &&
    peakRowEdgeRatio >= 0.08;

  return {
    likelyPlate,
    contrast,
    edgeDensity,
    verticalEdgeDensity,
    horizontalEdgeDensity,
    strokeGroups,
    occupiedSectors,
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

export function assessLivePlate(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  region: NormalizedRegion,
): PlateAssessment {
  return assessSource(video, video.videoWidth, video.videoHeight, canvas, region);
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

export function burstResemblesPlate(assessments: PlateAssessment[]): boolean {
  if (assessments.length === 0) return false;
  const requiredFrames = Math.max(2, Math.ceil(assessments.length / 2));
  return assessments.filter((assessment) => assessment.likelyPlate).length >= requiredFrames;
}
