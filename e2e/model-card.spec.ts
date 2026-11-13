import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

test('iris: the model card is incomplete until its purpose is typed, then travels with the run', async ({
  page,
}) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /iris\.csv/ }).click();
  await expect(page.getByText('150 rows · 5 columns')).toBeVisible();
  await page.selectOption('#target-select', 'species');
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60000 });

  const panel = page.getByTestId('model-card-panel');
  await expect(panel).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('model-card-status')).toContainText('incomplete');

  // Nothing typed: the card says so itself, and lists what was never run.
  const read = async (testId: string) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId(testId).first().click(),
    ]);
    return readFile(await download.path(), 'utf8');
  };
  const empty = await read('model-card-markdown');
  expect(empty).toContain('This card is incomplete');
  expect(empty).toContain('**Intended use:** Not stated.');
  expect(empty).toContain('## Not assessed');
  expect(empty).toContain('protected group: not assessed');

  await page.getByTestId('model-card-intendedUse').fill('Teaching example for a botany class.');
  await expect(page.getByTestId('model-card-status')).toContainText('intended use stated');

  const html = await read('model-card-html');
  expect(html).toContain('Teaching example for a botany class.');
  expect(html).not.toContain('This card is incomplete');
  expect(html).toContain('iris.csv, 150 rows × 5 columns');
  expect(html).not.toContain('<script');

  // The stored run gives the same card, with what was typed.
  const history = page.getByTestId('runs-history');
  await history.getByRole('link', { name: 'iris · species' }).click();
  await expect(page.getByTestId('run-view')).toBeVisible();
  const stored = await read('model-card-markdown');
  expect(stored).toContain('**Intended use:** Teaching example for a botany class.');
});
