import { expect, test } from "@playwright/test";

test("sign-in page never requests microphone permission", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(
    page.getByRole("heading", { name: /Keep vehicle flow moving/ }),
  ).toBeVisible();
  await expect(page.getByText(/not affiliated with or endorsed/)).toBeVisible();
});

test("sign-in entry point is available without requesting camera access", async ({
  context,
  page,
}) => {
  await context.clearPermissions();
  await page.goto("/sign-in");
  await expect(
    page.getByRole("button", { name: /secure sign in/i }),
  ).toBeVisible();
});
