import { expect, test, type Page } from '@playwright/test';

test.use({ locale: 'en-US' });

async function train(page: Page, button: 'train-button' | 'train-again') {
  await page.getByTestId(button).click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60000 });
}

test('iris: the ledger counts distinct runs on a test set, not trainings', async ({ page }) => {
  await page.goto('/ml?demo=iris&target=species');
  // Nothing was scored yet: the ledger has nothing to say.
  await expect(page.getByTestId('train-button')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('ledger-panel')).toHaveCount(0);

  await train(page, 'train-button');
  const panel = page.getByTestId('ledger-panel');
  await expect(panel).toHaveAttribute('data-level', 'first');
  await expect(page.getByTestId('ledger-reads')).toHaveText('1 run scored');

  // The same columns on the same split give the same numbers: nothing new is read.
  await train(page, 'train-again');
  await expect(page.getByTestId('ledger-reads')).toHaveText('1 run scored');

  // One column less is another configuration, scored on the same test rows.
  await page
    .getByTestId('column-card-sepal_width')
    .getByRole('button', { name: 'Exclude' })
    .click();
  await train(page, 'train-button');
  await expect(panel).toHaveAttribute('data-level', 'reused');
  await expect(page.getByTestId('ledger-reads')).toHaveText('2 distinct runs scored');
  // Two runs are not enough to offer another split to shop with.
  await expect(page.getByTestId('ledger-fresh')).toHaveCount(0);

  // The stored run keeps the count as it stood when it was scored.
  const history = page.getByTestId('runs-history');
  await history.getByRole('link', { name: 'iris · species' }).first().click();
  await expect(page.getByTestId('run-ledger')).toContainText('distinct configuration no. 2');
});

test('iris: a worn test set offers a fresh split, and the ledger outlives the session', async ({
  page,
}) => {
  // Open the lab once so the database exists, then write four earlier readings
  // of this file and target: what a user who trained four variants would hold.
  await page.goto('/ml?demo=iris&target=species');
  await train(page, 'train-button');
  await expect(page.getByTestId('ledger-reads')).toHaveText('1 run scored');
  await page.evaluate(async () => {
    const sep = '\u001f';
    const file = ['iris.csv', 150, 5, 'species'].join(sep);
    const testSet = [file, 'random', '42'].join(sep);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('labml');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('open failed'));
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('ledger', 'readwrite');
      for (let i = 0; i < 4; i++) {
        tx.objectStore('ledger').add({ file, testSet, seed: 42, config: `earlier-${i}`, at: i });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('write failed'));
    });
    db.close();
  });

  // Another day: the count is there before any training.
  await page.reload();
  const panel = page.getByTestId('ledger-panel');
  await expect(panel).toHaveAttribute('data-level', 'worn', { timeout: 30000 });
  await expect(page.getByTestId('ledger-reads')).toHaveText('5 distinct runs scored');
  await expect(panel).toContainText('Counted before this training');
  await expect(page.getByTestId('ledger-verdict')).toContainText(
    'Read the best score as optimistic',
  );

  await page.getByTestId('ledger-fresh').click();
  // A split nothing was scored on: the panel goes quiet until the run is in.
  await expect(panel).toHaveCount(0);
  await train(page, 'train-button');
  await expect(page.getByTestId('ledger-reads')).toHaveText('1 run scored');
  await expect(page.getByTestId('ledger-split')).toHaveText('split 2 of this file · seed 43');
  await expect(page.getByTestId('ledger-redeal')).toContainText('It is not new data');

  // The run was trained and stored with the seed of its split.
  const history = page.getByTestId('runs-history');
  await history.getByRole('link', { name: 'iris · species' }).first().click();
  await expect(page.getByTestId('run-ledger')).toContainText('split 2 of this file');
});
