import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });
test.setTimeout(120_000);

// NOTE: keep this title ASCII-only: it names the test-results directory.
test('counterfactual: a change found is loaded and flips the prediction shown', async ({
  page,
}) => {
  await page.goto('/ml?demo=fraud&target=status');
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60000 });
  await page.getByRole('cell', { name: /Logistic regression/ }).click();

  const prediction = page.getByTestId('what-if-prediction');
  await expect(prediction).toBeVisible({ timeout: 30000 });
  const before = (await prediction.textContent())!.trim();

  await page.getByTestId('counterfactual-button').click();
  const box = page.getByTestId('counterfactual');
  await expect(box).toBeVisible({ timeout: 30000 });
  await expect(box).toContainText(`stop answering "${before}"`);
  const first = box.getByTestId('counterfactual-item').first();
  await expect(first).toBeVisible();
  // The first change names its column: lock that one and ask again.
  const column = (await first.locator('span').first().textContent())!.split(':')[0].trim();
  await expect(first).toContainText('The model then answers');
  await expect(first.getByTestId('counterfactual-followed')).toContainText(
    'other models that agreed',
  );
  await expect(box).toContainText('A counterfactual speaks of the model, not of the world');

  // Loading it changes the row, and the prediction shown is the class announced.
  await first.getByTestId('counterfactual-apply').click();
  await expect(prediction).not.toHaveText(before, { timeout: 30000 });
  // A new row empties the answer, which described the previous one.
  await expect(page.getByTestId('counterfactual')).toHaveCount(0);

  // Locked, the column is left alone and named.
  await page.getByTestId(`lock-${column}`).check();
  await page.getByTestId('counterfactual-button').click();
  const again = page.getByTestId('counterfactual');
  await expect(again).toBeVisible({ timeout: 30000 });
  await expect(again.getByTestId('counterfactual-kept')).toContainText(
    `Left as they are because you locked them: ${column}.`,
  );
  for (const item of await again.getByTestId('counterfactual-item').all()) {
    await expect(item.locator('span').first()).not.toContainText(`${column}:`);
  }

  // A regression has no other class to reach: the button is not offered.
  await page.goto('/ml?demo=mpg&target=mpg');
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId('what-if-prediction')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('counterfactual-button')).toHaveCount(0);
});
