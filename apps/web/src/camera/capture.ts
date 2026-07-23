const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

interface PhotoCapabilitiesTrack extends MediaStreamTrack {
  getCapabilities(): MediaTrackCapabilities;
}

interface ImageCaptureLike {
  takePhoto(): Promise<Blob>;
}

type ImageCaptureConstructor = new (track: PhotoCapabilitiesTrack) => ImageCaptureLike;

function imageCaptureConstructor(): ImageCaptureConstructor | undefined {
  return (window as typeof window & { ImageCapture?: ImageCaptureConstructor }).ImageCapture;
}

async function canvasPhoto(video: HTMLVideoElement, canvas: HTMLCanvasElement): Promise<Blob> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) throw new Error("Camera has not produced a readable frame");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas is unavailable");
  context.drawImage(video, 0, 0, width, height);
  try {
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error("JPEG encoding failed"))),
        "image/jpeg",
        0.92,
      );
    });
    return blob;
  } finally {
    context.clearRect(0, 0, width, height);
    canvas.width = 1;
    canvas.height = 1;
  }
}

export async function takePhoto(
  stream: MediaStream,
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): Promise<Blob> {
  const [track] = stream.getVideoTracks();
  if (!track) throw new Error("No active video track");
  const Constructor = imageCaptureConstructor();
  if (Constructor) {
    try {
      const blob = await new Constructor(track).takePhoto();
      if (blob.type === "image/jpeg") return blob;
    } catch {
      // Safari and some camera drivers expose ImageCapture but fail at runtime.
    }
  }
  return canvasPhoto(video, canvas);
}

export async function captureBurst(
  stream: MediaStream,
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  frameCount = 4,
  intervalMilliseconds = 250,
): Promise<Blob[]> {
  if (frameCount < 3 || frameCount > 5) throw new Error("Burst must contain 3 to 5 frames");
  const frames: Blob[] = [];
  for (let index = 0; index < frameCount; index += 1) {
    frames.push(await takePhoto(stream, video, canvas));
    if (index < frameCount - 1) await sleep(intervalMilliseconds);
  }
  return frames;
}
