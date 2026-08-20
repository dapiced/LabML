import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { Header } from '@/app/Header';
import i18n from '@/lib/i18n';

function renderHeader() {
  return render(
    <MemoryRouter>
      <Header />
    </MemoryRouter>,
  );
}

describe('Header', () => {
  beforeEach(async () => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    await i18n.changeLanguage('en');
  });

  it('shows the app name and the main navigation', () => {
    renderHeader();
    expect(screen.getByText('LabML')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ML Lab' })).toHaveAttribute('href', '/ml');
  });

  it('switches the interface language and persists it', async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(screen.getByRole('button', { name: 'Français' }));
    expect(document.documentElement.lang).toBe('fr');
    expect(localStorage.getItem('labml-lang')).toBe('fr');
    expect(screen.getByRole('link', { name: 'Accueil' })).toBeInTheDocument();
  });

  it('cycles the theme preference and applies the dark class', async () => {
    const user = userEvent.setup();
    renderHeader();
    const toggle = screen.getByRole('button', { name: 'Change theme' });
    // Stored default is "system"; first click goes to "light", second to "dark".
    await user.click(toggle);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    await user.click(toggle);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('labml-theme')).toBe('dark');
  });
});
