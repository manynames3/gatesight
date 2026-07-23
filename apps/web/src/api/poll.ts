import type { ApiClient } from "./client";
import type { CaptureResult } from "./generated";

const terminal = new Set([
  "RECOGNIZED",
  "NEEDS_REVIEW",
  "NO_PLATE",
  "MULTIPLE_PLATES",
  "FAILED",
]);

export async function pollCapture(
  client: ApiClient,
  captureId: string,
  signal: AbortSignal,
  onUpdate: (capture: CaptureResult) => void,
): Promise<CaptureResult> {
  let delay = 750;
  const deadline = Date.now() + 120_000;
  while (!signal.aborted && Date.now() < deadline) {
    const result = await client.getCapture(captureId);
    onUpdate(result);
    if (terminal.has(result.status)) return result;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(resolve, delay);
      signal.addEventListener(
        "abort",
        () => {
          window.clearTimeout(timeout);
          reject(new DOMException("Polling aborted", "AbortError"));
        },
        { once: true },
      );
    });
    delay = Math.min(8_000, Math.round(delay * 1.7));
  }
  throw new Error(signal.aborted ? "Polling stopped" : "Processing is taking longer than expected");
}
