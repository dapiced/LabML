import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { HomePage } from '@/features/home/HomePage';
import i18n from '@/lib/i18n';

function renderHome() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

/**
 * V41 — the home page's status card. It said « the three modules are live »
 * and listed them, a sentence written at V22 and never touched through the
 * eighteen waves that followed: SQL, the local chat, the forecasts, the
 * documentation, the privacy page. The card now names the latest delivered
 * wave from the build's version — which `changelog.test.ts` pins to the last
 * wave PLAN.md records — and points at the CHANGELOG for the rest.
 */
describe('HomePage — what is new', () => {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
  const wave = `V${version.split('.')[1]}`;

  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('names the latest delivered wave, read from the build version', () => {
    renderHome();
    expect(screen.getByText(new RegExp(`\\b${wave}\\b`))).toBeInTheDocument();
  });

  it('links to the CHANGELOG on the repository', () => {
    renderHome();
    expect(screen.getByRole('link', { name: /changelog/i })).toHaveAttribute(
      'href',
      'https://github.com/dapiced/LabML/blob/main/CHANGELOG.md',
    );
  });

  it('no longer counts three modules', () => {
    renderHome();
    expect(screen.queryByText(/three modules/i)).toBeNull();
    expect(screen.getByText("What's new")).toBeInTheDocument();
  });

  it('says the same in French', async () => {
    await i18n.changeLanguage('fr');
    renderHome();
    expect(screen.getByText('Quoi de neuf')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`\\b${wave}\\b`))).toBeInTheDocument();
  });
});
