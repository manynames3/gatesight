import { describe, expect, it } from "vitest";

import { cognitoLogoutUrl } from "./logout";

describe("cognitoLogoutUrl", () => {
  it("uses Cognito's required client_id and logout_uri parameters", () => {
    const value = cognitoLogoutUrl({
      cognitoDomain: "https://example.auth.us-east-1.amazoncognito.com",
      clientId: "public-client",
      logoutUri: "https://gatesight.pages.dev/sign-in",
    });

    const url = new URL(value);
    expect(url.origin).toBe("https://example.auth.us-east-1.amazoncognito.com");
    expect(url.pathname).toBe("/logout");
    expect(url.searchParams.get("client_id")).toBe("public-client");
    expect(url.searchParams.get("logout_uri")).toBe(
      "https://gatesight.pages.dev/sign-in",
    );
    expect(url.searchParams.has("post_logout_redirect_uri")).toBe(false);
  });

  it("normalizes a Cognito domain with a trailing slash", () => {
    expect(
      cognitoLogoutUrl({
        cognitoDomain: "https://example.auth.us-east-1.amazoncognito.com/",
        clientId: "public-client",
        logoutUri: "http://localhost:5173/sign-in",
      }),
    ).toBe(
      "https://example.auth.us-east-1.amazoncognito.com/logout?client_id=public-client&logout_uri=http%3A%2F%2Flocalhost%3A5173%2Fsign-in",
    );
  });
});
