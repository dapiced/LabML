import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

test('data assistant answers counting, grouping and honesty questions on titanic', async ({
  page,
}) => {
  await page.goto('/ai/chat');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Ask your data');

  await page.getByRole('button', { name: /titanic\.csv/ }).click();
  await expect(page.getByText('891 rows · 15 columns')).toBeVisible();

  const input = page.getByLabel('Your question');
  await input.fill('How many rows where sex is female?');
  await page.getByRole('button', { name: 'Ask' }).click();
  // 314 female passengers — computed from the raw CSV, verifiable by hand.
  await expect(page.getByTestId('chat-assistant').last()).toContainText('314 rows match', {
    timeout: 15000,
  });

  await input.fill('average age by pclass');
  await page.getByRole('button', { name: 'Ask' }).click();
  const grouped = page.getByTestId('chat-assistant').last();
  await expect(grouped).toContainText('average of age by pclass', { timeout: 15000 });
  await expect(grouped).toContainText('38.233'); // 1st class mean age
  await expect(grouped).toContainText('25.141'); // 3rd class mean age

  await input.fill('tell me a joke about icebergs');
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(page.getByTestId('chat-assistant').last()).toContainText('not a language model', {
    timeout: 15000,
  });
});

test('suggestion chips ask a real question and the hub links here', async ({ page }) => {
  await page.goto('/ai');
  await page.getByRole('link', { name: 'Open the data assistant' }).click();
  await expect(page).toHaveURL(/\/ai\/chat$/);

  await page.getByRole('button', { name: /titanic\.csv/ }).click();
  await expect(page.getByText('891 rows · 15 columns')).toBeVisible();

  await page.getByRole('button', { name: 'how many missing values?' }).click();
  const answer = page.getByTestId('chat-assistant').last();
  await expect(answer).toContainText('Missing cells', { timeout: 15000 });
  await expect(answer).toContainText('deck'); // titanic's famously incomplete column
});
