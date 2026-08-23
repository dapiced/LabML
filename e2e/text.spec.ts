import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });
// Training the zoo on 155 encoded features takes longer than the 30 s default.
test.setTimeout(90_000);

test('reviews: the text column trains, and the words explain the model', async ({ page }) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /reviews\.csv/ }).click();
  await expect(page.getByText('240 rows · 6 columns')).toBeVisible();

  // The review column is profiled as free text, not as a category.
  await expect(page.getByTestId('column-card-review')).toContainText('text');

  await page.selectOption('#target-select', 'satisfied');
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60_000 });

  // Text is a feature now: nothing is reported as skipped, and the encoded
  // feature count is far past the four source columns.
  const leaderboard = page.getByTestId('leaderboard');
  await expect(leaderboard).not.toContainText('skipped');
  await expect(leaderboard).toContainText(/1\d\d features after encoding/);

  // The winner clearly beats the majority-class baseline — the signal is the text.
  await expect(page.getByTestId('insights')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('importance')).toContainText('review');

  // V35: on this file the crowned model is Gaussian Naive Bayes, whose
  // probabilities saturate to 0/1 — occlusion then measures exactly zero.
  // The card must SAY that rather than vanish, and point at a way forward.
  const words = page.getByTestId('word-effects');
  await expect(words).toBeVisible();
  await expect(words).toContainText('its probabilities are saturated');
  await expect(words).toContainText('Pick another model in the leaderboard');

  // And on a model that gives graded probabilities, the words do speak.
  await page.getByTestId('leaderboard').getByText('Gradient boosting').click();
  await expect(words).toContainText('Words that move the answer', { timeout: 30_000 });
  // Effects are signed — at least one word pushes each way on this dataset.
  await expect(words).toContainText('+');
  await expect(words).toContainText('−');
  await expect(words).toContainText('erasing one word rarely flips a prediction');
});

test('reviews in French: the words card speaks French too', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('labml-lang', 'fr'));
  await page.goto('/ml');
  await page.getByRole('button', { name: /reviews\.csv/ }).click();
  await expect(page.getByText('240 lignes · 6 colonnes')).toBeVisible();
  await page.selectOption('#target-select', 'satisfied');
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60_000 });

  const words = page.getByTestId('word-effects');
  await expect(words).toBeVisible({ timeout: 30_000 });
  // Le refus est traduit lui aussi — une carte qui se tait n'apprend rien.
  await expect(words).toContainText('ses probabilités sont saturées');
  await page.getByTestId('leaderboard').getByText('Gradient boosting').click();
  await expect(words).toContainText('Les mots qui font bouger la réponse', { timeout: 30_000 });
});
