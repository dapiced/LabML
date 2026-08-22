import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

// V27: the local language model is an OPTION. These tests cover the two
// states every visitor can actually hit — no model deployed, and a model
// offered on a machine that cannot run it. The 355 MB download itself is
// never exercised in CI: that is a deliberate scope choice, not an oversight.

test('with no model deployed, the chat answers exactly as before', async ({ page }) => {
  await page.goto('/ai/chat');
  await page.getByRole('button', { name: /titanic\.csv/ }).click();
  await expect(page.getByText('891 rows · 15 columns')).toBeVisible();

  // Nothing to offer, so nothing is claimed: the picker stays out of the way.
  await expect(page.getByTestId('engine-picker')).toHaveCount(0);

  await page.getByLabel('Your question').fill('How many rows where sex is female?');
  await page.getByRole('button', { name: 'Ask' }).click();
  const answer = page.getByTestId('chat-assistant').last();
  await expect(answer).toContainText('314', { timeout: 20_000 });
  await expect(answer).toContainText('answered by the deterministic interpreter');
});

test('a model offered on a machine without WebGPU is refused BY NAME, with its weight stated', async ({
  page,
}) => {
  // A manifest is served, but this browser has no WebGPU: the honest outcome
  // is a named refusal, never a download that could not run.
  await page.route('**/llm/manifest.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        repo: 'onnx-community/Qwen3-0.6B-DQ-ONNX',
        revision: 'main',
        license: 'Apache-2.0',
        totalBytes: 372_000_000,
        files: [],
      }),
    }),
  );
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { get: () => undefined });
  });

  await page.goto('/ai/chat');
  await page.getByRole('button', { name: /titanic\.csv/ }).click();
  await expect(page.getByText('891 rows · 15 columns')).toBeVisible();

  const picker = page.getByTestId('engine-picker');
  await expect(picker).toBeVisible({ timeout: 20_000 });
  // The weight is stated up front, before anything is fetched.
  await expect(picker).toContainText('355 MB');
  await expect(page.getByTestId('llm-no-webgpu')).toContainText('no WebGPU');
  // The model cannot be selected, and the deterministic engine still answers.
  await expect(page.getByTestId('engine-llm')).toBeDisabled();
  await page.getByLabel('Your question').fill('How many rows where sex is female?');
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(page.getByTestId('chat-assistant').last()).toContainText('314', {
    timeout: 20_000,
  });
});
