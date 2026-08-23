import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });
test.setTimeout(180_000);

/**
 * V37 — speed, and the comfort of a long session.
 *
 * The two things worth pinning in a real browser: helper cores are ANNOUNCED
 * like every other decision the lab makes, and a run trained across several
 * cores is the same run — nothing about the leaderboard changes because of
 * where a family happened to be fitted.
 */
test('the helper cores are announced by name, and the run is unchanged', async ({ page }) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /titanic\.csv/ }).click();
  await expect(page.getByText('891 rows · 15 columns')).toBeVisible();
  await page.selectOption('#target-select', 'survived');
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 120_000 });

  const leaderboard = page.getByTestId('leaderboard');
  // The announcement names how many cores helped and which families they took.
  await expect(leaderboard).toContainText(/\d helper cores?:/);
  await expect(leaderboard).toContainText('trained in parallel');
  // Parallelism is an optimisation: no family may go missing because of it.
  await expect(leaderboard).not.toContainText('failed');
  await expect(leaderboard.locator('tbody tr')).toHaveCount(9);

  // A model fitted in a helper crosses back as JSON and is rebuilt here. If
  // that rebuild were broken (it was, through structured clone) the first
  // prediction would throw — the inference column is where that shows.
  const rows = await leaderboard.locator('tbody tr').allInnerTexts();
  expect(rows.every((row) => row.includes('ms'))).toBe(true);
});

/**
 * V37 — three or more runs read against the oldest, which is where the
 * session started. Three separate pairwise diffs would make the reader do the
 * joining; this table does it for them.
 */
test('iris: three runs compare in one table, against the oldest', async ({ page }) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /iris\.csv/ }).click();
  await expect(page.getByText('150 rows · 5 columns')).toBeVisible();
  await page.selectOption('#target-select', 'species');

  // Run A: everything. Run B: one feature dropped. Run C: a second one too.
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60_000 });
  await page
    .getByTestId('column-card-petal_width')
    .getByRole('button', { name: 'Exclude' })
    .click();
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60_000 });
  await page
    .getByTestId('column-card-sepal_width')
    .getByRole('button', { name: 'Exclude' })
    .click();
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60_000 });

  const history = page.getByTestId('runs-history');
  const checkboxes = history.getByRole('checkbox');
  await expect(checkboxes).toHaveCount(3);
  await checkboxes.nth(2).check(); // oldest — the reference
  await checkboxes.nth(1).check();
  await checkboxes.nth(0).check();
  await page.getByTestId('compare-many-open').click();

  const table = page.getByTestId('compare-many-page');
  await expect(table).toBeVisible();
  await expect(table).toContainText('Session comparison');
  // The oldest run is labelled as the reference, exactly once.
  await expect(table.getByText('reference', { exact: true })).toHaveCount(1);
  // The champion row and the per-model matrix both read across all three runs.
  await expect(table).toContainText('Best model');
  await expect(table).toContainText('Naive baseline');
  // The features card names what each later run dropped relative to the first.
  await expect(table).toContainText('petal_width');
  await expect(table).toContainText('sepal_width');
});
