import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./client";
import { pollCapture } from "./poll";

afterEach(() => {
  vi.useRealTimers();
});

describe("pollCapture", () => {
  it("returns a terminal result immediately", async () => {
    const result = { recordId: "cap_123", status: "RECOGNIZED" as const };
    const client = { getCapture: vi.fn().mockResolvedValue(result) } as unknown as ApiClient;
    const update = vi.fn();
    await expect(
      pollCapture(client, "cap_123", new AbortController().signal, update),
    ).resolves.toEqual(result);
    expect(update).toHaveBeenCalledWith(result);
  });

  it("backs off while queued and then returns", async () => {
    vi.useFakeTimers();
    const queued = { recordId: "cap_123", status: "QUEUED" as const };
    const recognized = { recordId: "cap_123", status: "RECOGNIZED" as const };
    const client = {
      getCapture: vi.fn().mockResolvedValueOnce(queued).mockResolvedValueOnce(recognized),
    } as unknown as ApiClient;
    const promise = pollCapture(client, "cap_123", new AbortController().signal, vi.fn());
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual(recognized);
  });

  it("stops before requesting when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const getCapture = vi.fn();
    const client = { getCapture } as unknown as ApiClient;
    await expect(pollCapture(client, "cap_123", controller.signal, vi.fn())).rejects.toThrow(
      "Polling stopped",
    );
    expect(getCapture).not.toHaveBeenCalled();
  });
});
