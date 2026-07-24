/* Generated contract surface. Regenerate with `make contracts`. */
export type Direction = "ENTRY" | "EXIT";
export type CaptureStatus =
  | "UPLOADING"
  | "QUEUED"
  | "PROCESSING"
  | "RECOGNIZED"
  | "NEEDS_REVIEW"
  | "NO_PLATE"
  | "MULTIPLE_PLATES"
  | "FAILED";

export interface Facility {
  tenantId: string;
  recordId: string;
  name: string;
  timezone: string;
}

export interface Station {
  tenantId: string;
  recordId: string;
  facilityId: string;
  name: string;
  direction: Direction;
  armed?: boolean;
  commissioned?: boolean;
  lastHeartbeatAt?: string;
}

export interface PresignedFrame {
  frameIndex: number;
  key: string;
  url: string;
  fields: Record<string, string>;
  expiresIn: number;
}

export interface CaptureCreated {
  captureId: string;
  status: "UPLOADING";
  uploads: PresignedFrame[];
  receivedAtServer: string;
  estimatedCapturedAtServer: string;
  correlationId: string;
}

export interface CaptureUploadsRefreshed {
  captureId: string;
  status: "UPLOADING";
  uploads: PresignedFrame[];
}

export interface CaptureResult {
  recordId: string;
  status: CaptureStatus;
  observationId?: string;
  failureCode?: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
