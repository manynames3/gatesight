import type { NormalizedRegion } from "./plateGate";

interface Size {
  width: number;
  height: number;
}

interface OverlayRect extends Size {
  x: number;
  y: number;
}

export function coverOverlayRegion(
  source: Size,
  viewport: Size,
  overlay: OverlayRect,
): NormalizedRegion | null {
  if (
    source.width <= 0 ||
    source.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    overlay.width <= 0 ||
    overlay.height <= 0
  ) {
    return null;
  }

  const scale = Math.max(
    viewport.width / source.width,
    viewport.height / source.height,
  );
  const renderedWidth = source.width * scale;
  const renderedHeight = source.height * scale;
  const cropX = (renderedWidth - viewport.width) / 2;
  const cropY = (renderedHeight - viewport.height) / 2;

  return {
    x: Math.max(0, (overlay.x + cropX) / renderedWidth),
    y: Math.max(0, (overlay.y + cropY) / renderedHeight),
    width: Math.min(1, overlay.width / renderedWidth),
    height: Math.min(1, overlay.height / renderedHeight),
  };
}

export function guideRegion(
  video: HTMLVideoElement,
  guide: HTMLElement,
): NormalizedRegion | null {
  const videoRect = video.getBoundingClientRect();
  const guideRect = guide.getBoundingClientRect();
  return coverOverlayRegion(
    { width: video.videoWidth, height: video.videoHeight },
    { width: videoRect.width, height: videoRect.height },
    {
      x: guideRect.left - videoRect.left,
      y: guideRect.top - videoRect.top,
      width: guideRect.width,
      height: guideRect.height,
    },
  );
}
