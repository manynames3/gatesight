import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "./client";

afterEach(() => {
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
});
