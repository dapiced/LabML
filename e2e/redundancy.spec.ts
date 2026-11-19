import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

// NOTE: keep this title ASCII-only: it names the test-results directory.
test('titanic: twin columns are flagged on their cards, and excluded by the user only', async ({
  page,
}) => {
  await page.goto('/ml?demo=titanic&target=survived');
  // class/pclass, embarked/embark_town, and adult_male read off who. The twin
  // of the target, alive, is a leak and is flagged as one, not as a twin.
  await expect(page.getByTestId('redundant-summary')).toContainText(
    '5 columns say the same thing as another',
    { timeout: 30000 },
  );
  await expect(page.getByTestId('redundant-pclass')).toContainText(
    'Says the same thing as "class".',
  );
  await expect(page.getByTestId('redundant-embark_town')).toContainText(
    'Says the same thing as "embarked".',
  );
  await expect(page.getByTestId('redundant-adult_male')).toContainText('Can be read off "who".');
  await expect(page.getByTestId('redundant-who')).toHaveCount(0);
  await expect(page.getByTestId('redundant-alive')).toHaveCount(0);

  // Flagged, not removed: both are still in until the user excludes one.
  const card = page.getByTestId('column-card-class');
  await card.getByRole('button', { name: 'Exclude' }).click();
  await expect(page.getByTestId('redundant-pclass')).toHaveCount(0);
  await expect(page.getByTestId('redundant-summary')).toContainText('3 columns');
});
