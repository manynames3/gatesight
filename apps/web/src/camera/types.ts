export type CameraPermission =
  | "idle"
  | "requesting"
  | "granted"
  | "denied"
  | "missing"
  | "unreadable"
  | "disconnected";

export interface PendingBurst {
  id: string;
  capturedAt: Date;
  frames: Blob[];
  guideRegion: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface MotionSample {
  changedRatio: number;
  moving: boolean;
}
