import { describe, expect, it } from "vitest";
import {
  canAccess,
  defaultPathForRoles,
  verifiedRoles,
} from "./roles";

describe("verified GateSight roles", () => {
  it("accepts Cognito arrays and serialized group claims in precedence order", () => {
    expect(verifiedRoles(["VIEWER", "ADMIN", "untrusted"])).toEqual([
      "ADMIN",
      "VIEWER",
    ]);
    expect(verifiedRoles('["SECURITY","VIEWER"]')).toEqual([
      "SECURITY",
      "VIEWER",
    ]);
  });

  it("chooses a usable landing page and denies unsupported features", () => {
    expect(defaultPathForRoles(["OPERATOR"])).toBe("/station");
    expect(defaultPathForRoles(["SECURITY"])).toBe("/observations");
    expect(defaultPathForRoles([])).toBe("/access-required");
    expect(canAccess(["VIEWER"], ["ADMIN", "SECURITY"])).toBe(false);
  });

  it("handles the plain string format Cognito-compatible proxies may emit", () => {
    expect(verifiedRoles("OPERATOR, VIEWER")).toEqual(["OPERATOR", "VIEWER"]);
    expect(verifiedRoles({ groups: ["ADMIN"] })).toEqual([]);
  });
});
