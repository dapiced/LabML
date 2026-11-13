import { expect, test, type Page } from '@playwright/test';

test.use({ locale: 'en-US' });
test.setTimeout(120_000);

/** Inspects one family and replays the default what-if row through it. */
async function replay(page: Page, family: RegExp) {
  await page.getByRole('cell', { name: family }).click();
  const prediction = page.getByTestId('what-if-prediction');
  await expect(prediction).toBeVisible({ timeout: 30000 });
  await page.getByTestId('replay-button').click();
  const box = page.getByTestId('glass-box');
  await expect(box).toBeVisible({ timeout: 30000 });
  return { box, predicted: (await prediction.textContent())!.trim() };
}

// NOTE: keep this title ASCII-only: it names the test-results directory.
test('glass box: each family replays a row to the prediction shown', async ({ page }) => {
  await page.goto('/ml?demo=iris&target=species');
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60000 });

  // The tree: questions in the units of the file, down to a leaf.
  const tree = await replay(page, /Decision tree/);
  await expect(tree.box).toHaveAttribute('data-kind', 'tree');
  await expect(tree.box.locator('ol li').first()).toContainText(
    /(petal|sepal)_(length|width) < [\d.]+\? (yes|no)/,
  );
  await expect(tree.box.getByTestId('glass-answer')).toContainText(
    `The tree answers ${tree.predicted}.`,
  );
  await expect(tree.box.getByTestId('glass-answer')).toContainText(
    'training rows end in the same leaf',
  );

  // k-NN: five rows of the file, and their vote.
  const knn = await replay(page, /k-nearest neighbors/i);
  await expect(knn.box).toHaveAttribute('data-kind', 'knn');
  await expect(knn.box.getByTestId('glass-neighbours').locator('tbody tr')).toHaveCount(5);
  await expect(knn.box.getByTestId('glass-answer')).toContainText(
    `The model answers ${knn.predicted}.`,
  );

  // The forest: a count of its trees.
  const forest = await replay(page, /Random forest/);
  await expect(forest.box.getByTestId('glass-answer')).toContainText(`40 trees voted`);
  await expect(forest.box.getByTestId('glass-answer')).toContainText(
    `The forest answers ${forest.predicted}.`,
  );

  // The boosting: a curve that ends on the class predicted, and the validation rows.
  const boosting = await replay(page, /Gradient boosting/i);
  await expect(boosting.box.getByTestId('glass-answer')).toContainText(
    `the share of "${boosting.predicted}" the model begins with`,
  );
  await expect(boosting.box.getByTestId('glass-validation')).toContainText('validation rows');

  // A new row empties the replay, like the explanation: it described another row.
  await page.getByTestId('what-if').locator('input[type="number"]').first().fill('7.7');
  await expect(page.getByTestId('glass-box')).toHaveCount(0);
  await expect(page.getByTestId('replay-button')).toBeVisible();

  // A family with no steps says so instead of offering a replay.
  await page.getByRole('cell', { name: /Logistic regression/ }).click();
  await expect(page.getByTestId('glass-none')).toContainText('one weighted sum', {
    timeout: 30000,
  });
  await expect(page.getByTestId('replay-button')).toHaveCount(0);
});
