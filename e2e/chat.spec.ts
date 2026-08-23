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

  await input.fill('average age');
  await page.getByRole('button', { name: 'Ask' }).click();
  // V27.2: titanic's age column has 177 holes. The mean is built from 714
  // values, so the sentence must not imply it was built from all 891 rows.
  const partial = page.getByTestId('chat-assistant').last();
  await expect(partial).toContainText('29.699', { timeout: 15000 });
  await expect(partial).toContainText('714 usable values out of 891 rows');

  await input.fill('tell me a joke about icebergs');
  await page.getByRole('button', { name: 'Ask' }).click();
  // The refusal no longer claims "I am not a language model" — since V27 one
  // can be loaded. What it must still do is refuse rather than invent.
  const refusal = page.getByTestId('chat-assistant').last();
  await expect(refusal).toContainText('rather say so than invent an answer', { timeout: 15000 });
  // V27.1: a refusal names nobody. It used to be badged "answered by the
  // deterministic interpreter", which read as an answer; with the model
  // selected it claimed the model had read the question. Neither was true.
  await expect(refusal).toContainText('did not understand');
  await expect(refusal).not.toContainText('answered by');
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

test('V30 — a question it only half reads is refused, not answered short', async ({ page }) => {
  await page.goto('/ai/chat');
  await page.getByRole('button', { name: /titanic\.csv/ }).click();
  await expect(page.getByText('891 rows · 15 columns')).toBeVisible();

  const input = page.getByLabel('Your question');
  const ask = page.getByRole('button', { name: 'Ask' });

  // Before V30 this answered 891 — the whole table — because the keyword
  // grammar knows "how many" and knows nothing about "women", so it kept the
  // count and dropped the condition. The number was wrong and the badge said
  // the deterministic interpreter had read the question.
  await input.fill('how many women?');
  await ask.click();
  const refused = page.getByTestId('chat-assistant').last();
  await expect(refused).toContainText('did not understand', { timeout: 15000 });
  await expect(refused).not.toContainText('891 rows match');

  // Same shape in French, and the same refusal.
  await input.fill('average age of women');
  await ask.click();
  await expect(page.getByTestId('chat-assistant').last()).toContainText('did not understand', {
    timeout: 15000,
  });

  // What it DOES read, it still answers — the guard did not cost the questions
  // the grammar genuinely understands.
  await input.fill('How many rows where sex is female?');
  await ask.click();
  await expect(page.getByTestId('chat-assistant').last()).toContainText('314 rows match', {
    timeout: 15000,
  });
});
