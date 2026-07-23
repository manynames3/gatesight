import type { PresignedFrame } from "../api/generated";

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

export async function uploadFrame(
  upload: PresignedFrame,
  frame: Blob,
  signal: AbortSignal,
  onProgress: (percent: number) => void,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (signal.aborted) throw new DOMException("Upload aborted", "AbortError");
    try {
      await new Promise<void>((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open("POST", upload.url);
        request.responseType = "text";
        request.upload.onprogress = (event) => {
          if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
        };
        request.onerror = () => reject(new Error("Network failed during direct S3 upload"));
        request.onload = () => {
          if (request.status >= 200 && request.status < 300) resolve();
          else reject(new Error(`S3 upload failed (${request.status})`));
        };
        signal.addEventListener(
          "abort",
          () => {
            request.abort();
            reject(new DOMException("Upload aborted", "AbortError"));
          },
          { once: true },
        );
        const form = new FormData();
        Object.entries(upload.fields).forEach(([key, value]) => form.append(key, value));
        form.append("file", frame, `frame-${upload.frameIndex}.jpg`);
        request.send(form);
      });
      onProgress(100);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await wait(Math.min(4_000, 400 * 2 ** attempt));
    }
  }
  throw lastError;
}
