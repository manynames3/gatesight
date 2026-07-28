import type {
  CaptureCreated,
  CaptureResult,
  CaptureUploadsRefreshed,
  Facility,
  Page,
  Station,
} from "./generated";

export type OperationalStatus = "healthy" | "attention" | "critical" | "unknown";

export interface SystemHealth {
  status: OperationalStatus;
  service: string;
  environment: string;
  checkedAt: string;
  tenantId: string;
  components: {
    controlApi: {
      status: OperationalStatus;
      detail: string;
    };
    recognitionWorker: {
      status: OperationalStatus;
      functionName?: string;
      state: string;
      lastUpdateStatus: string;
      lastModified?: string;
      memoryMb?: number;
      timeoutSeconds?: number;
    };
    recognitionQueue: {
      status: OperationalStatus;
      configured: boolean;
      visible: number;
      inFlight: number;
      delayed: number;
    };
    outbox: {
      status: OperationalStatus;
      pending: number;
      published: number;
      failed: number;
      total: number;
      oldestPendingAt: string | null;
    };
    stations: {
      status: OperationalStatus;
      configured: number;
      uncommissioned: number;
      total: number;
      healthy: number;
      stale: number;
      staleAfterSeconds: number;
      stations: Array<{
        stationId: string;
        facilityId: string;
        name: string;
        lastHeartbeatAt: string | null;
        commissioned: boolean;
        status: "healthy" | "stale" | "not_commissioned";
      }>;
    };
    deadLetterQueue: {
      status: OperationalStatus;
      configured: boolean;
      visible: number;
      inFlight: number;
      delayed: number;
    };
  };
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly correlationId: string | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
  correlationId?: string;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

function cancellationReason(signal: AbortSignal): unknown {
  const reason = signal.reason as unknown;
  return reason ?? new DOMException("The request was canceled.", "AbortError");
}

export class ApiClient {
  constructor(
    private readonly origin: string,
    private readonly token: (
      forceRefresh?: boolean,
    ) => Promise<string | undefined> | string | undefined,
    private readonly requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ) {}

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const callerSignal = init.signal;
    if (callerSignal?.aborted) {
      throw cancellationReason(callerSignal);
    }

    const controller = new AbortController();
    let timedOut = false;
    let timeoutError: ApiError | null = null;
    let rejectCallerAbort: ((reason?: unknown) => void) | null = null;
    const callerAbort = new Promise<never>((_resolve, reject) => {
      rejectCallerAbort = reject;
    });
    const forwardCallerAbort = () => {
      const reason = callerSignal
        ? cancellationReason(callerSignal)
        : new DOMException("The request was canceled.", "AbortError");
      controller.abort(reason);
      rejectCallerAbort?.(reason);
    };
    callerSignal?.addEventListener("abort", forwardCallerAbort, { once: true });

    let rejectTimeout: ((reason?: unknown) => void) | null = null;
    const timeout = new Promise<never>((_resolve, reject) => {
      rejectTimeout = reject;
    });
    const timeoutId = setTimeout(() => {
      timedOut = true;
      timeoutError = new ApiError(
        "GateSight took too long to respond. Check your connection and try again.",
        0,
        "REQUEST_TIMEOUT",
        null,
      );
      controller.abort(timeoutError);
      rejectTimeout?.(timeoutError);
    }, Math.max(1, this.requestTimeoutMs));

    try {
      return await Promise.race([
        fetch(url, { ...init, signal: controller.signal }),
        timeout,
        callerAbort,
      ]);
    } catch (error) {
      if (timedOut) {
        throw (
          timeoutError ??
          new ApiError(
            "GateSight took too long to respond. Check your connection and try again.",
            0,
            "REQUEST_TIMEOUT",
            null,
          )
        );
      }
      if (callerSignal?.aborted) {
        throw cancellationReason(callerSignal);
      }
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        "GateSight could not be reached. Check your network connection and try again.",
        0,
        "NETWORK_ERROR",
        null,
      );
    } finally {
      clearTimeout(timeoutId);
      callerSignal?.removeEventListener("abort", forwardCallerAbort);
    }
  }

  private async responseError(response: Response): Promise<ApiError> {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    const correlationId =
      body.correlationId ?? response.headers.get("x-correlation-id");

    if (response.status === 401) {
      return new ApiError(
        "Your secure session is no longer valid. Sign in again.",
        response.status,
        "UNAUTHORIZED",
        correlationId,
      );
    }
    if (response.status === 403 && body.error?.message === "no GateSight role") {
      return new ApiError(
        "Your account does not have a GateSight role. Ask an administrator to grant access.",
        response.status,
        "ROLE_REQUIRED",
        correlationId,
      );
    }
    if (response.status === 403) {
      return new ApiError(
        "You do not have permission to access this GateSight feature.",
        response.status,
        "FORBIDDEN",
        correlationId,
      );
    }
    if (response.status === 429) {
      return new ApiError(
        "GateSight is receiving too many requests. Wait a moment and try again.",
        response.status,
        body.error?.code ?? "TOO_MANY_REQUESTS",
        correlationId,
      );
    }
    if (response.status >= 500) {
      return new ApiError(
        "GateSight is temporarily unavailable. Try again in a moment.",
        response.status,
        body.error?.code ?? "SERVICE_UNAVAILABLE",
        correlationId,
      );
    }
    return new ApiError(
      body.error?.message ?? `The request could not be completed (${response.status}).`,
      response.status,
      body.error?.code ?? "REQUEST_FAILED",
      correlationId,
    );
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    idempotencyKey?: string,
  ): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let accessToken: string | undefined;
      try {
        accessToken = await this.token(attempt === 1);
      } catch {
        throw new ApiError(
          "Your secure session could not be verified. Sign in again.",
          401,
          "AUTHENTICATION_FAILED",
          null,
        );
      }
      const headers = new Headers(init.headers);
      headers.set("Accept", "application/json");
      if (init.body) headers.set("Content-Type", "application/json");
      if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
      if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
      const response = await this.fetchWithTimeout(`${this.origin}${path}`, {
        ...init,
        headers,
        credentials: "omit",
        cache: "no-store",
      });
      if (response.status === 401 && attempt === 0) continue;
      if (response.status === 403 && attempt === 0) {
        const body = (await response
          .clone()
          .json()
          .catch(() => ({}))) as { error?: { message?: string } };
        if (body.error?.message === "no GateSight role") continue;
      }
      if (!response.ok) {
        throw await this.responseError(response);
      }
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    }
    throw new ApiError("Authentication could not be renewed", 401, "UNAUTHORIZED", null);
  }

  getServerTime(signal?: AbortSignal): Promise<{ serverTime: string; unixTimeMs: number }> {
    return this.request("/v1/time", signal ? { signal } : {});
  }

  getSystemHealth(): Promise<SystemHealth> {
    return this.request("/v1/system/health");
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
      guideRegion?: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      synthetic?: boolean;
    },
    key: string,
  ): Promise<CaptureCreated> {
    return this.request(
      "/v1/captures",
      { method: "POST", body: JSON.stringify(body) },
      key,
    );
  }

  refreshCaptureUploads(captureId: string): Promise<CaptureUploadsRefreshed> {
    return this.request(
      `/v1/captures/${encodeURIComponent(captureId)}/refresh-uploads`,
      { method: "POST" },
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

  getCapture(captureId: string, signal?: AbortSignal): Promise<CaptureResult> {
    return this.request(
      `/v1/captures/${encodeURIComponent(captureId)}`,
      signal ? { signal } : {},
    );
  }

  getObservation(observationId: string): Promise<Record<string, unknown>> {
    return this.request(`/v1/observations/${encodeURIComponent(observationId)}`);
  }

  reviewObservation(
    observationId: string,
    body: {
      decision: "CONFIRMED" | "CORRECTED" | "REJECTED";
      correctedPlate?: string;
      note: string;
    },
    idempotencyKey: string,
  ): Promise<{ observationId: string; reviewDecision: string; state: string }> {
    return this.request(
      `/v1/observations/${encodeURIComponent(observationId)}/review`,
      { method: "POST", body: JSON.stringify(body) },
      idempotencyKey,
    );
  }

  createRegistration(body: {
    normalizedPlate: string;
    displayPlate: string;
    facilityId: string;
    plateRegion?: string;
    description?: string;
    validFrom: string;
    status: "ACTIVE" | "BLOCKED";
  }, idempotencyKey: string): Promise<Record<string, unknown>> {
    return this.request(
      "/v1/registrations",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
      idempotencyKey,
    );
  }

  updateRegistration(
    registrationId: string,
    body: {
      displayPlate?: string;
      plateRegion?: string;
      description?: string;
      status?: "ACTIVE" | "EXPIRED" | "BLOCKED";
    },
  ): Promise<Record<string, unknown>> {
    return this.request(`/v1/registrations/${encodeURIComponent(registrationId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  transitionAlert(
    alertId: string,
    action: "acknowledge" | "resolve",
    idempotencyKey: string,
  ): Promise<Record<string, unknown>> {
    return this.request(
      `/v1/alerts/${encodeURIComponent(alertId)}/${action}`,
      { method: "POST" },
      idempotencyKey,
    );
  }

  deleteObservationMedia(
    observationId: string,
    idempotencyKey: string,
  ): Promise<{ observationId: string; mediaDeletedAt: string }> {
    return this.request(
      `/v1/observations/${encodeURIComponent(observationId)}/delete-media`,
      { method: "POST" },
      idempotencyKey,
    );
  }

  getPage<T>(path: string, facilityId: string, cursor?: string): Promise<Page<T>> {
    const query = new URLSearchParams({ facilityId });
    if (cursor) query.set("cursor", cursor);
    return this.request(`/v1${path}?${query.toString()}`);
  }
}
