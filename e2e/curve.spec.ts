import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

// V26: the learning curve answers "would more data help?" for one model —
// retrained on growing seeded prefixes, scored on the same test set, with a
// bootstrap band and a plain-language verdict.
test('titanic: the learning curve traces, in numbers, whether more data helps', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto('/ml');
  await page.getByRole('button', { name: /titanic\.csv/ }).click();
  await expect(page.getByText('891 rows · 15 columns')).toBeVisible();
  await page.selectOption('#target-select', 'survived');
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 90_000 });

  const panel = page.getByTestId('learning-curve');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Would more data help?');
  // The baseline is flat by definition — it is not even offered.
  await expect(
    panel.getByRole('combobox').locator('option', { hasText: 'Naive baseline' }),
  ).toHaveCount(0);

  await panel.getByRole('combobox').selectOption('gbdt');
  await page.getByTestId('curve-start').click();

  const result = page.getByTestId('curve-result');
  await expect(result).toBeVisible({ timeout: 120_000 });
  // One dot per announced training size, on a real chart.
  expect(await result.locator('circle').count()).toBeGreaterThanOrEqual(4);
  await expect(result).toContainText('Gradient boosting');
  // The verdict speaks plainly, whichever way the curve went.
  await expect(page.getByTestId('curve-verdict')).toContainText(/(still climbing|has flattened)/);
  // The numbers behind the chart are one click away.
  await result.locator('summary').click();
  await expect(result.locator('table')).toBeVisible();
  await expect(result).toContainText(/\[\d\.\d{3} ; \d\.\d{3}\]/);
});
