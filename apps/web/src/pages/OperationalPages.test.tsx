import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient, type SystemHealth } from "../api/client";
import type { Facility, Station } from "../api/generated";
import { DataPage } from "./DataPage";
import { FacilitiesPage } from "./FacilitiesPage";
import { SystemPage } from "./SystemPage";

const auth = vi.hoisted(() => ({
  getApiToken: vi.fn().mockResolvedValue("token"),
  user: {
    profile: {
      email: "security@example.test",
      "cognito:groups": ["SECURITY"],
    },
  },
}));

vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => auth,
}));

const atlanta: Facility = {
  tenantId: "tenant_test",
  recordId: "fac_atlanta",
  name: "Atlanta",
  timezone: "America/New_York",
};

const dallas: Facility = {
  tenantId: "tenant_test",
  recordId: "fac_dallas",
  name: "Dallas",
  timezone: "America/Chicago",
};

const health: SystemHealth = {
  status: "healthy",
  service: "control-api",
  environment: "dev",
  checkedAt: "2026-07-28T14:00:00Z",
  tenantId: "tenant_test",
  components: {
    controlApi: { status: "healthy", detail: "Authenticated request succeeded" },
    recognitionWorker: {
      status: "healthy",
      state: "Active",
      lastUpdateStatus: "Successful",
      lastModified: "2026-07-28T13:00:00Z",
    },
    recognitionQueue: {
      status: "healthy",
      configured: true,
      visible: 0,
      inFlight: 0,
      delayed: 0,
    },
    outbox: {
      status: "healthy",
      pending: 0,
      published: 12,
      failed: 0,
      total: 12,
      oldestPendingAt: null,
    },
    stations: {
      status: "healthy",
      configured: 1,
      uncommissioned: 0,
      total: 1,
      healthy: 1,
      stale: 0,
      staleAfterSeconds: 180,
      stations: [{
        stationId: "station_atlanta_entry",
        facilityId: "fac_atlanta",
        name: "Main Entry Gate",
        lastHeartbeatAt: "2026-07-28T13:59:30Z",
        commissioned: true,
        status: "healthy",
      }],
    },
    deadLetterQueue: {
      status: "healthy",
      configured: true,
      visible: 0,
      inFlight: 0,
      delayed: 0,
    },
  },
};

describe("operational pages", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.history.replaceState({}, "", "/");
  });

  it("keeps existing records visible when a manual data refresh fails", async () => {
    vi.spyOn(ApiClient.prototype, "getFacilities").mockResolvedValue({
      items: [atlanta],
      nextCursor: null,
    });
    vi.spyOn(ApiClient.prototype, "getPage")
      .mockResolvedValueOnce({
        items: [{
          recordId: "obs_1",
          capturedAt: "2026-07-28T14:05:00Z",
          state: "RECOGNIZED",
          direction: "ENTRY",
        }],
        nextCursor: null,
      })
      .mockRejectedValueOnce(new Error("Failed to fetch"));

    render(<DataPage path="/observations" />);

    expect(await screen.findByText("Recognized")).toBeInTheDocument();
    expect(screen.getByText("Entry")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Showing the most recent successful results",
    );
    expect(screen.getByText("Recognized")).toBeInTheDocument();
  });

  it("shows a retryable initial data failure without claiming it is loading or empty", async () => {
    vi.spyOn(ApiClient.prototype, "getFacilities").mockResolvedValue({
      items: [atlanta],
      nextCursor: null,
    });
    vi.spyOn(ApiClient.prototype, "getPage").mockRejectedValue(
      new Error("Failed to fetch"),
    );

    render(<DataPage path="/observations" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Check your connection",
    );
    expect(screen.queryByText(/Loading observations/)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "No observations yet" }))
      .not.toBeInTheDocument();
  });

  it("does not describe a facilities request failure as empty configuration", async () => {
    vi.spyOn(ApiClient.prototype, "getFacilities").mockRejectedValue(
      new Error("Failed to fetch"),
    );

    render(<DataPage path="/observations" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Facilities could not be loaded",
    );
    expect(screen.queryByRole("heading", { name: "No facilities configured" }))
      .not.toBeInTheDocument();
  });

  it("ignores a data response that arrives after the facility changes", async () => {
    let resolveAtlanta:
      | ((value: { items: Array<Record<string, unknown>>; nextCursor: null }) => void)
      | undefined;
    vi.spyOn(ApiClient.prototype, "getFacilities").mockResolvedValue({
      items: [atlanta, dallas],
      nextCursor: null,
    });
    const getPage = vi.spyOn(ApiClient.prototype, "getPage").mockImplementation((_path, facilityId) => {
      if (facilityId === atlanta.recordId) {
        return new Promise((resolve) => {
          resolveAtlanta = resolve;
        });
      }
      return Promise.resolve({
        items: [{ recordId: "obs_dallas", description: "Dallas gate activity" }],
        nextCursor: null,
      });
    });

    render(<DataPage path="/observations" />);
    const select = await screen.findByRole("combobox", { name: "Facility" });
    await waitFor(() => {
      expect(getPage).toHaveBeenCalledWith(
        "/observations",
        atlanta.recordId,
      );
    });
    fireEvent.change(select, { target: { value: dallas.recordId } });

    expect(await screen.findByText("Dallas gate activity")).toBeInTheDocument();
    resolveAtlanta?.({
      items: [{ recordId: "obs_atlanta", description: "Outdated Atlanta activity" }],
      nextCursor: null,
    });
    await waitFor(() => {
      expect(screen.queryByText("Outdated Atlanta activity")).not.toBeInTheDocument();
    });
  });

  it("shows per-facility station failures without discarding successful cards", async () => {
    const atlantaStation: Station = {
      tenantId: "tenant_test",
      recordId: "station_atlanta_entry",
      facilityId: atlanta.recordId,
      name: "Atlanta Main Entry",
      direction: "ENTRY",
      commissioned: true,
    };
    const dallasStation: Station = {
      tenantId: "tenant_test",
      recordId: "station_dallas_exit",
      facilityId: dallas.recordId,
      name: "Dallas Main Exit",
      direction: "EXIT",
      commissioned: true,
    };
    let dallasAttempts = 0;
    vi.spyOn(ApiClient.prototype, "getFacilities").mockResolvedValue({
      items: [atlanta, dallas],
      nextCursor: null,
    });
    vi.spyOn(ApiClient.prototype, "getStations").mockImplementation((facilityId) => {
      if (facilityId === atlanta.recordId) {
        return Promise.resolve({ items: [atlantaStation], nextCursor: null });
      }
      dallasAttempts += 1;
      if (dallasAttempts === 1) return Promise.reject(new Error("Failed to fetch"));
      return Promise.resolve({ items: [dallasStation], nextCursor: null });
    });

    render(<FacilitiesPage />);

    expect(await screen.findByText("Atlanta Main Entry")).toBeInTheDocument();
    const dallasCard = screen.getByRole("heading", { name: "Dallas" }).closest("section");
    expect(dallasCard).not.toBeNull();
    expect(within(dallasCard as HTMLElement).getByRole("alert")).toHaveTextContent(
      "Check your connection",
    );
    await userEvent.click(within(dallasCard as HTMLElement).getByRole("button", {
      name: "Retry stations",
    }));
    expect(await within(dallasCard as HTMLElement).findByText("Dallas Main Exit")).toBeInTheDocument();
    expect(screen.getByText("Atlanta Main Entry")).toBeInTheDocument();
  });

  it("replaces an initial system-health failure with live status after retry", async () => {
    vi.spyOn(ApiClient.prototype, "getSystemHealth")
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValueOnce(health);

    render(<SystemPage />);

    expect(await screen.findByRole("heading", { name: "System health is unavailable" }))
      .toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Online")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "System health is unavailable" }))
      .not.toBeInTheDocument();
  });

  it("lets security staff register a vehicle from the empty state", async () => {
    vi.spyOn(ApiClient.prototype, "getFacilities").mockResolvedValue({
      items: [atlanta],
      nextCursor: null,
    });
    vi.spyOn(ApiClient.prototype, "getPage").mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    const create = vi
      .spyOn(ApiClient.prototype, "createRegistration")
      .mockResolvedValue({ recordId: "reg_1", status: "ACTIVE" });

    render(<DataPage path="/registrations" />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Register vehicle" }),
    );
    await userEvent.type(screen.getByRole("textbox", { name: "Plate" }), "ABC 123");
    const panel = screen.getByRole("heading", { name: "Register a vehicle" }).closest("section");
    expect(panel).not.toBeNull();
    await userEvent.click(
      within(panel as HTMLElement).getByRole("button", { name: "Register vehicle" }),
    );

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          normalizedPlate: "ABC123",
          displayPlate: "ABC 123",
          facilityId: atlanta.recordId,
          status: "ACTIVE",
        }),
        expect.stringMatching(/^registration:/),
      );
    });
  });

  it("reuses a registration key only while the request intent is unchanged", async () => {
    vi.spyOn(ApiClient.prototype, "getFacilities").mockResolvedValue({
      items: [atlanta],
      nextCursor: null,
    });
    vi.spyOn(ApiClient.prototype, "getPage").mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    const create = vi
      .spyOn(ApiClient.prototype, "createRegistration")
      .mockRejectedValueOnce(new Error("Connection dropped after save"))
      .mockRejectedValueOnce(new Error("Connection still unavailable"))
      .mockResolvedValueOnce({ recordId: "reg_edited", status: "ACTIVE" });

    render(<DataPage path="/registrations" />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Register vehicle" }),
    );
    const plate = screen.getByRole("textbox", { name: "Plate" });
    const panel = screen.getByRole("heading", { name: "Register a vehicle" }).closest("section");
    const save = within(panel as HTMLElement).getByRole("button", {
      name: "Register vehicle",
    });
    await userEvent.type(plate, "ABC 123");
    await userEvent.click(save);
    expect(await screen.findByText("Connection dropped after save")).toBeInTheDocument();
    await userEvent.click(save);
    expect(await screen.findByText("Connection still unavailable")).toBeInTheDocument();

    expect(create.mock.calls[1]?.[1]).toBe(create.mock.calls[0]?.[1]);
    await userEvent.clear(plate);
    await userEvent.type(plate, "XYZ 789");
    await userEvent.click(save);

    await waitFor(() => expect(create).toHaveBeenCalledTimes(3));
    expect(create.mock.calls[2]?.[0]).toEqual(
      expect.objectContaining({ normalizedPlate: "XYZ789" }),
    );
    expect(create.mock.calls[2]?.[1]).not.toBe(create.mock.calls[0]?.[1]);
  });

  it("reuses the alert action key after an ambiguous acknowledgement failure", async () => {
    vi.spyOn(ApiClient.prototype, "getFacilities").mockResolvedValue({
      items: [atlanta],
      nextCursor: null,
    });
    vi.spyOn(ApiClient.prototype, "getPage").mockResolvedValue({
      items: [{
        recordId: "alert_1",
        occurredAt: "2026-07-28T14:05:00Z",
        status: "OPEN",
        reason: "UNREGISTERED_ENTRY",
      }],
      nextCursor: null,
    });
    const transition = vi
      .spyOn(ApiClient.prototype, "transitionAlert")
      .mockRejectedValueOnce(new Error("Connection dropped after save"))
      .mockResolvedValueOnce({ alertId: "alert_1", status: "ACKNOWLEDGED" });

    render(<DataPage path="/alerts" />);

    await userEvent.click(await screen.findByRole("button", { name: "Open" }));
    await userEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    expect(await screen.findByText("Connection dropped after save")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Acknowledge" }));

    await waitFor(() => expect(transition).toHaveBeenCalledTimes(2));
    expect(transition.mock.calls[0]?.[0]).toBe("alert_1");
    expect(transition.mock.calls[0]?.[1]).toBe("acknowledge");
    expect(transition.mock.calls[0]?.[2]).toMatch(/^alert:alert_1:acknowledge:/);
    expect(transition.mock.calls[1]?.[2]).toBe(transition.mock.calls[0]?.[2]);
    expect(await screen.findByText("Alert acknowledged.")).toBeInTheDocument();
  });

  it("lets security staff correct an observation that needs review", async () => {
    vi.spyOn(ApiClient.prototype, "getFacilities").mockResolvedValue({
      items: [atlanta],
      nextCursor: null,
    });
    vi.spyOn(ApiClient.prototype, "getPage").mockResolvedValue({
      items: [{
        recordId: "obs_review",
        capturedAt: "2026-07-28T14:05:00Z",
        state: "NEEDS_REVIEW",
        direction: "ENTRY",
      }],
      nextCursor: null,
    });
    vi.spyOn(ApiClient.prototype, "getObservation").mockResolvedValue({
      recordId: "obs_review",
      capturedAt: "2026-07-28T14:05:00Z",
      state: "NEEDS_REVIEW",
      direction: "ENTRY",
      mediaUrls: [],
    });
    const review = vi
      .spyOn(ApiClient.prototype, "reviewObservation")
      .mockResolvedValue({
        observationId: "obs_review",
        reviewDecision: "CORRECTED",
        state: "RECOGNIZED",
      });

    render(<DataPage path="/observations" />);

    await userEvent.click(await screen.findByRole("button", { name: "Open" }));
    await screen.findByRole("heading", { name: "Complete human review" });
    await userEvent.type(screen.getByRole("textbox", { name: "Correct plate" }), "ABC 123");
    await userEvent.type(
      screen.getByRole("textbox", { name: "Review note" }),
      "Verified against the captured frame",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save review" }));

    await waitFor(() => {
      expect(review).toHaveBeenCalledWith(
        "obs_review",
        {
          decision: "CORRECTED",
          correctedPlate: "ABC123",
          note: "Verified against the captured frame",
        },
        expect.stringMatching(/^review:obs_review:/),
      );
    });
    expect(await screen.findByText(/Review saved/)).toBeInTheDocument();
  });

  it("keeps review disabled until failed protected details are retried", async () => {
    vi.spyOn(ApiClient.prototype, "getFacilities").mockResolvedValue({
      items: [atlanta],
      nextCursor: null,
    });
    vi.spyOn(ApiClient.prototype, "getPage").mockResolvedValue({
      items: [{ recordId: "obs_retry", state: "NEEDS_REVIEW" }],
      nextCursor: null,
    });
    vi.spyOn(ApiClient.prototype, "getObservation")
      .mockRejectedValueOnce(new Error("Protected details unavailable"))
      .mockResolvedValueOnce({
        recordId: "obs_retry",
        state: "NEEDS_REVIEW",
        mediaUrls: [],
      });

    render(<DataPage path="/observations" />);

    await userEvent.click(await screen.findByRole("button", { name: "Open" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Review actions stay disabled",
    );
    expect(screen.queryByRole("heading", { name: "Complete human review" }))
      .not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry details" }));
    expect(await screen.findByRole("heading", { name: "Complete human review" }))
      .toBeInTheDocument();
  });

  it("reuses the same review idempotency key after an ambiguous failure", async () => {
    vi.spyOn(ApiClient.prototype, "getFacilities").mockResolvedValue({
      items: [atlanta],
      nextCursor: null,
    });
    vi.spyOn(ApiClient.prototype, "getPage").mockResolvedValue({
      items: [{ recordId: "obs_ambiguous", state: "NEEDS_REVIEW" }],
      nextCursor: null,
    });
    vi.spyOn(ApiClient.prototype, "getObservation").mockResolvedValue({
      recordId: "obs_ambiguous",
      state: "NEEDS_REVIEW",
      mediaUrls: [],
    });
    const review = vi
      .spyOn(ApiClient.prototype, "reviewObservation")
      .mockRejectedValueOnce(new Error("Connection dropped after save"))
      .mockResolvedValueOnce({
        observationId: "obs_ambiguous",
        reviewDecision: "CORRECTED",
        state: "RECOGNIZED",
      });

    render(<DataPage path="/observations" />);

    await userEvent.click(await screen.findByRole("button", { name: "Open" }));
    await screen.findByRole("heading", { name: "Complete human review" });
    await userEvent.type(screen.getByRole("textbox", { name: "Correct plate" }), "ABC123");
    await userEvent.type(
      screen.getByRole("textbox", { name: "Review note" }),
      "Verified captured frame",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save review" }));
    expect(await screen.findByText("Connection dropped after save")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save review" }));

    await waitFor(() => expect(review).toHaveBeenCalledTimes(2));
    expect(review.mock.calls[1]?.[2]).toBe(review.mock.calls[0]?.[2]);
  });

  it("preserves loaded older records and pauses automatic refresh", async () => {
    vi.spyOn(ApiClient.prototype, "getFacilities").mockResolvedValue({
      items: [atlanta],
      nextCursor: null,
    });
    vi.spyOn(ApiClient.prototype, "getPage")
      .mockResolvedValueOnce({
        items: [{ recordId: "obs_new", description: "Newer observation" }],
        nextCursor: "older-page",
      })
      .mockResolvedValueOnce({
        items: [{ recordId: "obs_old", description: "Older observation" }],
        nextCursor: null,
      });

    render(<DataPage path="/observations" />);

    expect(await screen.findByText("Newer observation")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByText("Older observation")).toBeInTheDocument();
    expect(screen.getByText("Auto-refresh paused after loading older records"))
      .toBeInTheDocument();
  });

  it("confirms media removal and reuses its key after an ambiguous failure", async () => {
    vi.spyOn(ApiClient.prototype, "getFacilities").mockResolvedValue({
      items: [atlanta],
      nextCursor: null,
    });
    vi.spyOn(ApiClient.prototype, "getPage").mockResolvedValue({
      items: [{ recordId: "obs_media", state: "NEEDS_REVIEW" }],
      nextCursor: null,
    });
    vi.spyOn(ApiClient.prototype, "getObservation").mockResolvedValue({
      recordId: "obs_media",
      state: "NEEDS_REVIEW",
      mediaAvailable: true,
      mediaUrls: [],
    });
    const remove = vi
      .spyOn(ApiClient.prototype, "deleteObservationMedia")
      .mockRejectedValueOnce(new Error("Connection dropped after removal"))
      .mockResolvedValueOnce({
        observationId: "obs_media",
        mediaDeletedAt: "2026-07-28T16:00:00Z",
      });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<DataPage path="/observations" />);

    await userEvent.click(await screen.findByRole("button", { name: "Open" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Delete saved media" }),
    );
    expect(await screen.findByText("Connection dropped after removal")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Delete saved media" }),
    );

    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("configured retention policy"),
    );
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(2));
    expect(remove.mock.calls[0]?.[0]).toBe("obs_media");
    expect(remove.mock.calls[0]?.[1]).toMatch(/^media-delete:obs_media:/);
    expect(remove.mock.calls[1]?.[1]).toBe(remove.mock.calls[0]?.[1]);
    expect(await screen.findByText(/media was removed from the app/))
      .toBeInTheDocument();
  });

  it("requires confirmation before resolving an alert", async () => {
    vi.spyOn(ApiClient.prototype, "getFacilities").mockResolvedValue({
      items: [atlanta],
      nextCursor: null,
    });
    vi.spyOn(ApiClient.prototype, "getPage").mockResolvedValue({
      items: [{ recordId: "alert_resolve", status: "OPEN" }],
      nextCursor: null,
    });
    const transition = vi
      .spyOn(ApiClient.prototype, "transitionAlert")
      .mockResolvedValue({ recordId: "alert_resolve", status: "RESOLVED" });
    vi.spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    render(<DataPage path="/alerts" />);

    await userEvent.click(await screen.findByRole("button", { name: "Open" }));
    await userEvent.click(screen.getByRole("button", { name: "Resolve alert" }));
    expect(transition).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Resolve alert" }));
    expect(transition).toHaveBeenCalledWith(
      "alert_resolve",
      "resolve",
      expect.stringMatching(/^alert:alert_resolve:resolve:/),
    );
  });

  it("opens the exact observation and facility linked from the camera result", async () => {
    window.history.replaceState(
      {},
      "",
      "/observations?facility=fac_dallas&record=obs_dallas",
    );
    vi.spyOn(ApiClient.prototype, "getFacilities").mockResolvedValue({
      items: [atlanta, dallas],
      nextCursor: null,
    });
    const getPage = vi.spyOn(ApiClient.prototype, "getPage").mockResolvedValue({
      items: [{ recordId: "obs_dallas", state: "RECOGNIZED" }],
      nextCursor: null,
    });
    const getObservation = vi
      .spyOn(ApiClient.prototype, "getObservation")
      .mockResolvedValue({
        recordId: "obs_dallas",
        state: "RECOGNIZED",
        normalizedPlate: "ABC123",
      });

    render(<DataPage path="/observations" />);

    await waitFor(() => {
      expect(getPage).toHaveBeenCalledWith("/observations", dallas.recordId);
      expect(getObservation).toHaveBeenCalledWith("obs_dallas");
    });
    expect(await screen.findByText("ABC123")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Facility" })).toHaveValue(
      dallas.recordId,
    );
  });
});
