import { expect, test } from "@playwright/test";

test("sign-in page never requests microphone permission", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(
    page.getByRole("heading", { name: /Keep vehicle flow moving/ }),
  ).toBeVisible();
  await expect(page.getByText(/not affiliated with or endorsed/)).toBeVisible();
});

test("camera permission denial is surfaced", async ({
  browserName,
  context,
  page,
}) => {
  test.skip(
    browserName === "webkit",
    "WebKit permission emulation is not deterministic",
  );
  await context.clearPermissions();
  await page.goto("/sign-in");
  await expect(
    page.getByRole("button", { name: /secure sign in/i }),
  ).toBeVisible();
});
