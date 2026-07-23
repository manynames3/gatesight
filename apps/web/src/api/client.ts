import type {
  CaptureCreated,
  CaptureResult,
  Facility,
  Page,
  Station,
} from "./generated";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly correlationId: string | null,
  ) {
    super(message);
  }
}

export class ApiClient {
  constructor(
    private readonly origin: string,
    private readonly token: () => string | undefined,
  ) {}

  private async request<T>(
    path: string,
    init: RequestInit = {},
    idempotencyKey?: string,
  ): Promise<T> {
    const token = this.token();
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body) headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
    const response = await fetch(`${this.origin}${path}`, {
      ...init,
      headers,
      credentials: "omit",
      cache: "no-store",
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: { code?: string; message?: string };
        correlationId?: string;
      };
      throw new ApiError(
        body.error?.message ?? `Request failed (${response.status})`,
        response.status,
        body.error?.code ?? "REQUEST_FAILED",
        body.correlationId ?? response.headers.get("x-correlation-id"),
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  getServerTime(): Promise<{ serverTime: string; unixTimeMs: number }> {
    return this.request("/v1/time");
  }

  getFacilities(): Promise<Page<Facility>> {
    return this.request("/v1/facilities");
  }

  getStations(facilityId: string): Promise<Page<Station>> {
    return this.request(`/v1/facilities/${encodeURIComponent(facilityId)}/stations`);
  }

  heartbeat(
    stationId: string,
    body: { armed: boolean; client_time: string; camera_device_hash: string | null },
  ): Promise<{ lastHeartbeatAt: string }> {
    return this.request(`/v1/stations/${encodeURIComponent(stationId)}/heartbeat`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  createCapture(
    body: {
      facilityId: string;
      stationId: string;
      frameCount: number;
      capturedAtClient: string;
      clientClockOffsetMs: number;
    },
    key: string,
  ): Promise<CaptureCreated> {
    return this.request(
      "/v1/captures",
      { method: "POST", body: JSON.stringify(body) },
      key,
    );
  }

  completeCapture(
    captureId: string,
    uploadedKeys: string[],
    key: string,
  ): Promise<{ captureId: string; status: "QUEUED" }> {
    return this.request(
      `/v1/captures/${encodeURIComponent(captureId)}/complete`,
      { method: "POST", body: JSON.stringify({ uploadedKeys }) },
      key,
    );
  }

  getCapture(captureId: string): Promise<CaptureResult> {
    return this.request(`/v1/captures/${encodeURIComponent(captureId)}`);
  }

  getPage<T>(path: string, facilityId: string): Promise<Page<T>> {
    const query = new URLSearchParams({ facilityId });
    return this.request(`${path}?${query.toString()}`);
  }
}
