export type GateSightRole = "ADMIN" | "SECURITY" | "OPERATOR" | "VIEWER";

export const roleOrder: readonly GateSightRole[] = [
  "ADMIN",
  "SECURITY",
  "OPERATOR",
  "VIEWER",
];

export function verifiedRoles(value: unknown): GateSightRole[] {
  let claims: unknown[] = [];
  if (Array.isArray(value)) {
    claims = value;
  } else if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      claims = Array.isArray(parsed)
        ? parsed
        : value.replace(/[[\]"']/g, "").split(/[,\s]+/);
    } catch {
      claims = value.replace(/[[\]"']/g, "").split(/[,\s]+/);
    }
  }
  const claimed = new Set(
    claims.filter((claim): claim is string => typeof claim === "string"),
  );
  return roleOrder.filter((role) => claimed.has(role));
}

export function defaultPathForRoles(roles: readonly GateSightRole[]): string {
  if (roles.includes("ADMIN") || roles.includes("OPERATOR")) return "/station";
  if (roles.includes("SECURITY") || roles.includes("VIEWER")) return "/observations";
  return "/access-required";
}

export function canAccess(
  roles: readonly GateSightRole[],
  allowed: readonly GateSightRole[],
): boolean {
  return roles.some((role) => allowed.includes(role));
}
