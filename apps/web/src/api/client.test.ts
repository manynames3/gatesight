import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "./client";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ApiClient authentication", () => {
  it("refreshes the token and retries once after a 401", async () => {
    const token = vi
      .fn<(forceRefresh?: boolean) => Promise<string | undefined>>()
      .mockResolvedValueOnce("expired-token")
      .mockResolvedValueOnce("renewed-token");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            serverTime: "2026-07-23T22:00:00Z",
            unixTimeMs: 1_774_214_400_000,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient("https://api.example.test", token);

    await expect(client.getServerTime()).resolves.toEqual({
      serverTime: "2026-07-23T22:00:00Z",
      unixTimeMs: 1_774_214_400_000,
    });

    expect(token.mock.calls).toEqual([[false], [true]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    const retryHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(firstHeaders.get("Authorization")).toBe("Bearer expired-token");
    expect(retryHeaders.get("Authorization")).toBe("Bearer renewed-token");
  });

  it("refreshes a stale session that predates its GateSight role", async () => {
    const token = vi
      .fn<(forceRefresh?: boolean) => Promise<string | undefined>>()
      .mockResolvedValueOnce("stale-token")
      .mockResolvedValueOnce("renewed-token");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: "FORBIDDEN", message: "no GateSight role" },
          }),
          {
            status: 403,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            serverTime: "2026-07-23T22:00:00Z",
            unixTimeMs: 1_774_214_400_000,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient("https://api.example.test", token);

    await expect(client.getServerTime()).resolves.toMatchObject({
      unixTimeMs: 1_774_214_400_000,
    });

    expect(token.mock.calls).toEqual([[false], [true]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a successful authenticated request", async () => {
    const token = vi
      .fn<(forceRefresh?: boolean) => Promise<string | undefined>>()
      .mockResolvedValue("current-token");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          serverTime: "2026-07-23T22:00:00Z",
          unixTimeMs: 1_774_214_400_000,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient("https://api.example.test", token);

    await client.getServerTime();

    expect(token.mock.calls).toEqual([[false]]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("uses versioned API routes for shared data pages", async () => {
    const token = vi
      .fn<(forceRefresh?: boolean) => Promise<string | undefined>>()
      .mockResolvedValue("current-token");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ items: [], nextCursor: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient("https://api.example.test", token);

    await client.getPage("/observations", "fac_san_diego");

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.example.test/v1/observations?facilityId=fac_san_diego",
    );
  });

  it("reads protected system health from the live API", async () => {
    const token = vi
      .fn<(forceRefresh?: boolean) => Promise<string | undefined>>()
      .mockResolvedValue("current-token");
    const health = {
      status: "healthy",
      service: "control-api",
      environment: "dev",
      checkedAt: "2026-07-24T03:22:00Z",
      tenantId: "tenant_portfolio",
      components: {},
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(health), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient("https://api.example.test", token);

    await expect(client.getSystemHealth()).resolves.toEqual(health);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.example.test/v1/system/health",
    );
  });

  it("requests fresh upload instructions for an existing capture", async () => {
    const token = vi
      .fn<(forceRefresh?: boolean) => Promise<string | undefined>>()
      .mockResolvedValue("current-token");
    const response = {
      captureId: "cap_01J123456789ABCDEFGHJKMNPQ",
      status: "UPLOADING",
      uploads: [],
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient("https://api.example.test", token);

    await expect(
      client.refreshCaptureUploads("cap_01J123456789ABCDEFGHJKMNPQ"),
    ).resolves.toEqual(response);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.example.test/v1/captures/cap_01J123456789ABCDEFGHJKMNPQ/refresh-uploads",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
  });

  it("uses protected action routes for review, registration, and alert handling", async () => {
    const token = vi.fn().mockResolvedValue("current-token");
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      () =>
        Promise.resolve(new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient("https://api.example.test", token);

    await client.reviewObservation(
      "obs_123",
      { decision: "CORRECTED", correctedPlate: "ABC123", note: "Verified image" },
      "review:obs_123:123456789",
    );
    await client.createRegistration(
      {
        normalizedPlate: "ABC123",
        displayPlate: "ABC 123",
        facilityId: "fac_san_diego",
        validFrom: "2026-07-28T12:00:00Z",
        status: "ACTIVE",
      },
      "registration:123456789",
    );
    await client.updateRegistration("reg_123", { status: "BLOCKED" });
    await client.transitionAlert(
      "alert_123",
      "acknowledge",
      "alert:alert_123:123456789",
    );
    await client.deleteObservationMedia(
      "obs_123",
      "media:obs_123:123456789",
    );

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.example.test/v1/observations/obs_123/review",
      "https://api.example.test/v1/registrations",
      "https://api.example.test/v1/registrations/reg_123",
      "https://api.example.test/v1/alerts/alert_123/acknowledge",
      "https://api.example.test/v1/observations/obs_123/delete-media",
    ]);
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Idempotency-Key"))
      .toBe("review:obs_123:123456789");
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("Idempotency-Key"))
      .toBe("registration:123456789");
    expect(new Headers(fetchMock.mock.calls[3]?.[1]?.headers).get("Idempotency-Key"))
      .toBe("alert:alert_123:123456789");
    expect(new Headers(fetchMock.mock.calls[4]?.[1]?.headers).get("Idempotency-Key"))
      .toBe("media:obs_123:123456789");
    expect(fetchMock.mock.calls[4]?.[1]?.method).toBe("POST");
  });

  it("turns a network failure into an actionable API error", async () => {
    const token = vi.fn().mockResolvedValue("current-token");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    const client = new ApiClient("https://api.example.test", token);

    await expect(client.getServerTime()).rejects.toMatchObject({
      name: "ApiError",
      status: 0,
      code: "NETWORK_ERROR",
      message:
        "GateSight could not be reached. Check your network connection and try again.",
    });
  });

  it("bounds a request and reports a timeout", async () => {
    vi.useFakeTimers();
    const token = vi.fn().mockResolvedValue("current-token");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient("https://api.example.test", token, 25);

    const result = expect(client.getServerTime()).rejects.toMatchObject({
      status: 0,
      code: "REQUEST_TIMEOUT",
      message:
        "GateSight took too long to respond. Check your connection and try again.",
    });
    await vi.advanceTimersByTimeAsync(26);
    await result;
  });

  it("preserves a caller's abort reason", async () => {
    const token = vi.fn().mockResolvedValue("current-token");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient("https://api.example.test", token);
    const controller = new AbortController();
    const reason = new DOMException("Page changed", "AbortError");

    const result = expect(client.getServerTime(controller.signal)).rejects.toBe(reason);
    controller.abort(reason);
    await result;
  });

  it("explains when a renewed session is still unauthorized", async () => {
    const token = vi
      .fn<(forceRefresh?: boolean) => Promise<string | undefined>>()
      .mockResolvedValueOnce("expired-token")
      .mockResolvedValueOnce("also-expired-token");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "UNAUTHORIZED", message: "missing verified identity" },
          correlationId: "corr-auth",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient("https://api.example.test", token);

    await expect(client.getSystemHealth()).rejects.toEqual(
      new ApiError(
        "Your secure session is no longer valid. Sign in again.",
        401,
        "UNAUTHORIZED",
        "corr-auth",
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("explains when the verified identity has no GateSight role", async () => {
    const token = vi
      .fn<(forceRefresh?: boolean) => Promise<string | undefined>>()
      .mockResolvedValueOnce("stale-token")
      .mockResolvedValueOnce("renewed-token");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "FORBIDDEN", message: "no GateSight role" },
          correlationId: "corr-role",
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient("https://api.example.test", token);

    await expect(client.getFacilities()).rejects.toMatchObject({
      status: 403,
      code: "ROLE_REQUIRED",
      correlationId: "corr-role",
      message:
        "Your account does not have a GateSight role. Ask an administrator to grant access.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      status: 403,
      body: { error: { message: "facility is not authorized" } },
      code: "FORBIDDEN",
      message: "You do not have permission to access this GateSight feature.",
    },
    {
      status: 429,
      body: { error: { code: "RATE_LIMITED" } },
      code: "RATE_LIMITED",
      message: "GateSight is receiving too many requests. Wait a moment and try again.",
    },
    {
      status: 503,
      body: { error: { code: "WORKER_UNAVAILABLE" } },
      code: "WORKER_UNAVAILABLE",
      message: "GateSight is temporarily unavailable. Try again in a moment.",
    },
    {
      status: 400,
      body: { error: { code: "INVALID_REQUEST", message: "Correct the submitted values." } },
      code: "INVALID_REQUEST",
      message: "Correct the submitted values.",
    },
  ])("explains HTTP $status failures", async ({ status, body, code, message }) => {
    const token = vi.fn().mockResolvedValue("current-token");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const client = new ApiClient("https://api.example.test", token);

    await expect(client.getFacilities()).rejects.toMatchObject({
      status,
      code,
      message,
    });
  });
});
