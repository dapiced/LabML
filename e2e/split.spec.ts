import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });
test.setTimeout(120_000);

// V35: the number stops flattering itself. Four things the user must SEE:
// the third split, the champion's selection-vs-test gap, an announced
// chronological split on dated data, and a lone column caught reading the
// target. Plus the 5x2 verdict on whether the ranking is real.

test('iris: the winner is picked on validation and reports its test gap', async ({ page }) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /iris\.csv/ }).click();
  await expect(page.getByText('150 rows · 5 columns')).toBeVisible();
  await page.selectOption('#target-select', 'species');
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60_000 });

  const leaderboard = page.getByTestId('leaderboard');
  // The ranked column is now the validation metric, with test beside it.
  await expect(leaderboard).toContainText('Accuracy (val)');
  await expect(leaderboard).toContainText('Test');
  // Three splits are announced, not two.
  await expect(leaderboard).toContainText(/validation rows/);

  // The champion line names both numbers and the gap between them.
  const gap = page.getByTestId('champion-gap');
  await expect(gap).toBeVisible();
  // Iris is separable enough that the top models reach 1.000 — the assertion
  // pins the SHAPE of the sentence (two figures and a gap), not the values.
  await expect(gap).toContainText(/was selected on validation at \d\.\d{3} and scores \d\.\d{3}/);
  await expect(gap).toContainText('never-selected split');
});

test('iris: 5x2 cross-validation says whether the ranking is real', async ({ page }) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /iris\.csv/ }).click();
  await page.selectOption('#target-select', 'species');
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60_000 });

  await page.getByTestId('robust-run').click();
  const verdict = page.getByTestId('robust-verdict');
  await expect(verdict).toBeVisible({ timeout: 90_000 });
  // Either wording is correct — what matters is that it counts the folds.
  await expect(verdict).toContainText(/of 10 folds/);
  // The panel says out loud that the test set stayed out of the folds.
  await expect(page.getByTestId('robust-rank')).toContainText('test set is never touched');
});

test('titanic: re-including the mirrored column raises a named leak warning', async ({ page }) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /titanic\.csv/ }).click();
  await expect(page.getByText('891 rows · 15 columns')).toBeVisible();
  await page.selectOption('#target-select', 'survived');

  // V6 excludes `alive` automatically; the user overrides that decision.
  await page.getByTestId('column-card-alive').getByRole('button', { name: 'Include' }).click();
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 90_000 });

  // V35 catches it again at training time — with a measured number.
  const warning = page.getByTestId('leak-warning');
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('« alive » alone predicts the target at 100.0%');
  await expect(warning).toContainText('almost always leakage');
});

test('energy: a dated file offers — and announces — a chronological split', async ({ page }) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /energy\.csv/ }).click();
  await expect(page.getByText('240 rows · 3 columns')).toBeVisible();
  await page.selectOption('#target-select', 'kwh');

  // The option exists because `date` is a date column — and only then.
  const split = page.getByTestId('split-mode');
  await expect(split).toBeVisible();
  await split.selectOption('chronological:date');

  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60_000 });

  // Announced in the run info, like every other decision the lab makes.
  await expect(page.getByTestId('leaderboard')).toContainText(
    'chronological split on date (oldest rows train, newest test)',
  );
});
