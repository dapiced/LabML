import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

test('titanic: the test set is sliced per segment and the analysis joins the run', async ({
  page,
}) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /titanic\.csv/ }).click();
  await expect(page.getByText('891 rows · 15 columns')).toBeVisible();
  await page.selectOption('#target-select', 'survived');
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60000 });

  // The analysis rides along with the winning model's insights.
  const panel = page.getByTestId('segments-panel');
  await expect(panel).toBeVisible({ timeout: 30000 });
  await expect(panel).toContainText('Accuracy');
  await expect(panel).toContainText('sliced by each categorical column');

  // class slices the test set per passenger class, with honest per-slice metrics.
  const classColumn = page.getByTestId('segments-column-class');
  await expect(classColumn).toBeVisible();
  await expect(classColumn).toContainText('First');
  await expect(classColumn).toContainText('Third');
  await expect(classColumn).toContainText('in the features');

  // The leaked alive column is out of the features yet still sliced — that is
  // exactly where proxy effects would hide.
  await expect(page.getByTestId('segments-column-alive')).toContainText('outside the features');

  // Deltas are oriented: at least one slice runs below the overall metric.
  await expect(panel.getByText(/^-0\.\d{3}$/).first()).toBeVisible();

  // The analysis survives the run.
  const history = page.getByTestId('runs-history');
  await history.getByRole('link', { name: 'titanic · survived' }).click();
  const artifacts = page.getByTestId('run-artifacts');
  await expect(artifacts).toBeVisible();
  await expect(artifacts).toContainText('Where the model fails');
  await expect(artifacts).toContainText('Third');
});
