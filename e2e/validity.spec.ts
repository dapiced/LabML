import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });
test.setTimeout(120_000);

/**
 * V40 — validity, consistency, and a score that explains itself.
 */
function impossibleCsv(): Buffer {
  const lines = ['nom,age,taux_reussite,date_debut,date_fin,quantite,prix_unitaire,total'];
  for (let i = 0; i < 60; i++) {
    // Two impossible ages, one impossible percentage, one reversed date pair,
    // one total that is not quantity × price — everything else is plausible.
    const age = i === 3 ? '200' : i === 7 ? '-4' : String(20 + (i % 50));
    const rate = i === 11 ? '130' : String(i % 100);
    const start = `2025-0${(i % 9) + 1}-0${(i % 8) + 1}`;
    const end = i === 5 ? '2024-01-01' : `2025-0${(i % 9) + 1}-0${(i % 8) + 2}`;
    const qty = String(1 + (i % 5));
    const unit = String(2 + (i % 4));
    const total = i === 9 ? '999' : String((1 + (i % 5)) * (2 + (i % 4)));
    lines.push(`ligne${i},${age},${rate},${start},${end},${qty},${unit},${total}`);
  }
  return Buffer.from(lines.join('\n'), 'utf-8');
}

test('impossible values and contradictory rows are named, with their rules', async ({ page }) => {
  await page.goto('/data');
  await page.getByTestId('data-file-input').setInputFiles({
    name: 'commandes.csv',
    mimeType: 'text/csv',
    buffer: impossibleCsv(),
  });
  await expect(page.getByTestId('recipe-result')).toBeVisible({ timeout: 60_000 });

  // Values that are present and correctly typed, and still impossible.
  const validity = page.getByTestId('issue-validity');
  await expect(validity).toBeVisible();
  await expect(validity).toContainText('age');
  await expect(validity).toContainText('age outside 0–120');
  await expect(validity).toContainText('percentage outside 0–100');

  // A row where two columns contradict each other.
  const consistency = page.getByTestId('issue-consistency');
  await expect(consistency).toBeVisible();
  await expect(consistency).toContainText('the end comes before the start');
  await expect(consistency).toContainText('the total is not quantity × price');
});

test('the quality score is explained by its parts, not asserted', async ({ page }) => {
  await page.goto('/data');
  await page.getByRole('button', { name: /cafe-sales\.csv/ }).click();
  await expect(page.getByTestId('recipe-result')).toBeVisible({ timeout: 60_000 });

  await page.getByText('How this score was computed', { exact: true }).click();
  const breakdown = page.getByTestId('score-breakdown');
  await expect(breakdown).toContainText('Missing cells');
  await expect(breakdown).toContainText('Duplicate rows');
  await expect(breakdown).toContainText('Impossible values');
  // The weights are shown, including the deliberate 105 total.
  await expect(breakdown).toContainText('105, not 100');
});

test('a clean file raises no validity or consistency card at all', async ({ page }) => {
  await page.goto('/data');
  // titanic has missing values and messy spellings, but every age is a real
  // age and no two columns contradict each other.
  await page.getByRole('button', { name: /titanic\.csv/ }).click();
  await expect(page.getByTestId('recipe-result')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('issue-validity')).toHaveCount(0);
  await expect(page.getByTestId('issue-consistency')).toHaveCount(0);
});
