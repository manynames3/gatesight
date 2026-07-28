import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./client";
import { pollCapture } from "./poll";

afterEach(() => {
  vi.useRealTimers();
});

describe("pollCapture", () => {
  it("returns a terminal result immediately", async () => {
    const result = { recordId: "cap_123", status: "RECOGNIZED" as const };
    const getCapture = vi.fn().mockResolvedValue(result);
    const client = { getCapture } as unknown as ApiClient;
    const controller = new AbortController();
    const update = vi.fn();
    await expect(
      pollCapture(client, "cap_123", controller.signal, update),
    ).resolves.toEqual(result);
    expect(getCapture).toHaveBeenCalledWith("cap_123", controller.signal);
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

  it("does not publish a result that resolves after polling is aborted", async () => {
    let resolveRequest:
      | ((value: { recordId: string; status: "RECOGNIZED" }) => void)
      | undefined;
    const getCapture = vi.fn(
      () =>
        new Promise<{ recordId: string; status: "RECOGNIZED" }>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const client = { getCapture } as unknown as ApiClient;
    const controller = new AbortController();
    const update = vi.fn();
    const polling = pollCapture(client, "cap_old", controller.signal, update);

    await vi.waitFor(() => {
      expect(getCapture).toHaveBeenCalledWith("cap_old", controller.signal);
    });
    controller.abort();
    resolveRequest?.({ recordId: "cap_old", status: "RECOGNIZED" });

    await expect(polling).rejects.toMatchObject({ name: "AbortError" });
    expect(update).not.toHaveBeenCalled();
  });
});
