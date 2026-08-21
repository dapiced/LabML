import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ReloadPrompt } from './ReloadPrompt';
import '@/lib/i18n';

const mockUseRegisterSW = vi.fn();
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (...args: unknown[]) => mockUseRegisterSW(...args) as never,
}));

function arm(offlineReady: boolean, needRefresh: boolean) {
  const setOfflineReady = vi.fn();
  const setNeedRefresh = vi.fn();
  const updateServiceWorker = vi.fn().mockResolvedValue(undefined);
  mockUseRegisterSW.mockReturnValue({
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  });
  return { setOfflineReady, setNeedRefresh, updateServiceWorker };
}

describe('ReloadPrompt', () => {
  it('renders nothing while the service worker has nothing to say', () => {
    arm(false, false);
    render(<ReloadPrompt />);
    expect(screen.queryByTestId('pwa-toast')).toBeNull();
  });

  it('offers a reload when a new version is waiting, and applies it on click', async () => {
    const { updateServiceWorker } = arm(false, true);
    render(<ReloadPrompt />);
    expect(screen.getByTestId('pwa-toast').textContent).toContain('new version');
    await userEvent.click(screen.getByRole('button', { name: /reload/i }));
    expect(updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it('announces offline readiness and can be dismissed', async () => {
    const { setOfflineReady, setNeedRefresh } = arm(true, false);
    render(<ReloadPrompt />);
    expect(screen.getByTestId('pwa-toast').textContent).toContain('offline');
    await userEvent.click(screen.getByRole('button', { name: /later/i }));
    expect(setOfflineReady).toHaveBeenCalledWith(false);
    expect(setNeedRefresh).toHaveBeenCalledWith(false);
  });
});
