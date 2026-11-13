import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

test('titanic: a group audit waits for a column, tells real gaps from noise, and joins the run and its card', async ({
  page,
}) => {
  await page.goto('/ml?demo=titanic&target=survived');
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60000 });

  const panel = page.getByTestId('group-audit-panel');
  await expect(panel).toBeVisible({ timeout: 30000 });
  // The lab names no column itself: nothing is audited until one is picked.
  await expect(page.getByTestId('group-audit-column')).toHaveValue('');
  await expect(page.getByTestId('group-audit-table')).toHaveCount(0);

  await page.getByTestId('group-audit-column').selectOption('sex');
  const table = page.getByTestId('group-audit-table');
  await expect(table).toBeVisible({ timeout: 30000 });
  // 178 test rows: 107 men, the reference, and 71 women.
  await expect(table).toContainText('male');
  await expect(table).toContainText('107');
  await expect(table).toContainText('71');
  await expect(table).toContainText('points: real');
  await expect(page.getByTestId('group-audit-scope')).toContainText(
    'read against « male », the largest group',
  );
  await expect(page.getByTestId('group-audit-findings')).toContainText(
    'The interval excludes zero',
  );

  // A column whose groups are too small is refused with its sizes.
  await page.getByTestId('group-audit-column').selectOption('deck');
  await expect(page.getByTestId('group-audit-refusal')).toContainText(
    'fewer than two groups have 20 test rows',
  );
  await expect(page.getByTestId('group-audit-table')).toHaveCount(0);

  // Back to an audit that says something; that one is kept with the run.
  await page.getByTestId('group-audit-column').selectOption('sex');
  await expect(page.getByTestId('group-audit-table')).toBeVisible({ timeout: 30000 });

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('model-card-markdown').first().click(),
  ]);
  const card = await readFile(await download.path(), 'utf8');
  expect(card).toContain('## Performance by group');
  expect(card).toContain('Audited on « sex »');
  expect(card).not.toContain('no group audit was run');

  const history = page.getByTestId('runs-history');
  await history.getByRole('link', { name: 'titanic · survived' }).click();
  await expect(page.getByTestId('artifact-group-audit')).toContainText('Audited on « sex »');
});
