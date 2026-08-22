import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

test('the privacy page states the promise, quotes the real policy and audits itself', async ({
  page,
}) => {
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('never leaves your browser');

  // The policy shown is the one served — the unit test pins them together, and
  // this checks the directive actually reaches the reader's screen.
  await expect(page.getByText("connect-src 'self'").first()).toBeVisible();

  // The four self-checks are the point of the page: they must all be there.
  for (const step of [
    'Cut the network',
    'Watch the Network tab',
    'Read the security policy',
    'Open local storage',
  ]) {
    await expect(page.getByRole('heading', { name: new RegExp(step, 'i') })).toBeVisible();
  }

  // The live audit: in a browser that only ever talked to this origin, the
  // verdict has to be "none to a third party".
  await page.getByTestId('privacy-audit-run').click();
  const result = page.getByTestId('privacy-audit-result');
  await expect(result).toBeVisible();
  await expect(result).toContainText('None to a third party');
});

test('the privacy page is reachable from the footer of any page', async ({ page }) => {
  await page.goto('/about');
  await page.getByRole('link', { name: 'Privacy', exact: true }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('never leaves your browser');
});
