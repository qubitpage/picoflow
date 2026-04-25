/**
 * PicoFlow live-prod e2e: signup -> dashboard -> mint key -> hit paid route -> revoke -> logout.
 * Runs against PICOFLOW_BASE_URL (defaults to https://picoflow.qubitpage.com).
 *
 * Run:
 *   cd tests/e2e
 *   npm install
 *   npx playwright install chromium
 *   npx playwright test
 */
import { test, expect, request as pwRequest } from "@playwright/test";

const RAND = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const EMAIL = `e2e-${RAND}@picoflow.test`;
const PASSWORD = "hunter2hunter2";
const ORG_NAME = `E2E Probe ${RAND}`;

test("signup -> mint key -> paid call -> revoke -> logout", async ({ page, baseURL }) => {
  // 1. Landing renders signup CTA
  await page.goto("/");
  await expect(page.getByRole("link", { name: /sign up|get started|create.*account/i }).first()).toBeVisible();

  // 2. Sign up
  await page.goto("/signup");
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  const orgInput = page.getByLabel(/org/i);
  if (await orgInput.count()) {
    await orgInput.first().fill(ORG_NAME);
  }
  await page.getByRole("button", { name: /sign up|create/i }).click();

  // 3. Land on /account (or /dashboard)
  await page.waitForURL(/\/(account|dashboard)/, { timeout: 15000 });

  // 4. Mint API key (form on /account)
  await page.goto("/account");
  // The MintKeyForm is the form whose submit reads "Mint a new key" / "Mintingâ€¦"
  const mintBtn = page.getByRole("button", { name: /^mint/i }).first();
  await expect(mintBtn).toBeVisible({ timeout: 10000 });
  await mintBtn.click();

  // The plaintext key is rendered inside a <pre> after the server action resolves.
  // Wait for the pattern itself to appear in the DOM.
  const keyLocator = page.locator("pre, code", { hasText: /pf_[0-9a-f]{12}_[0-9a-f]{32}/ }).first();
  await expect(keyLocator).toBeVisible({ timeout: 15000 });
  const keyText = (await keyLocator.textContent()) ?? "";
  const m = keyText.match(/pf_[0-9a-f]{12}_[0-9a-f]{32}/);
  expect(m, `expected pf_<prefix>_<secret>, got: ${keyText.slice(0, 200)}`).not.toBeNull();
  const key = m![0];

  // 5. Hit a paid route directly with the Bearer key.
  // Without payment header it should NOT be 401 (auth passed) — should be 402 (payment required).
  const api = await pwRequest.newContext({ baseURL });
  const resp = await api.get(`/api/aisa/data?symbol=BTC`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  // Acceptable: 402 (needs payment) OR 200 (if route is unmetered) — both prove auth worked.
  // 401/403/429 with this fresh org would be a regression.
  expect([200, 402]).toContain(resp.status());

  // 6. Revoke the key — find the revoke button row
  await page.goto("/account");
  const revoke = page.getByRole("button", { name: /revoke/i }).first();
  if (await revoke.count()) {
    await revoke.click();
    // Some UIs confirm — best-effort
    const confirm = page.getByRole("button", { name: /confirm|yes/i });
    if (await confirm.count()) await confirm.first().click();
  }

  // 7. After revoke, same key should fail with 401
  const respAfter = await api.get(`/api/aisa/data?symbol=BTC`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  expect(respAfter.status()).toBe(401);

  // 8. Logout
  const logout = page.getByRole("link", { name: /log out|logout|sign out/i }).or(
    page.getByRole("button", { name: /log out|logout|sign out/i }),
  );
  if (await logout.count()) {
    await logout.first().click();
    await page.waitForURL(/\/(login|$)/, { timeout: 10000 });
  }

  await api.dispose();
});

test("invalid login is rejected", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill("does-not-exist@picoflow.test");
  await page.getByLabel(/password/i).fill("wrongpassword");
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  // Should NOT navigate to /account
  await page.waitForTimeout(2000);
  expect(page.url()).not.toMatch(/\/account/);
});
