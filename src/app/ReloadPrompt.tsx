import { RefreshCw, WifiOff, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '@/components/ui/button';

/**
 * Registers the service worker and surfaces its two moments as a toast:
 * "ready to work offline" (dismissable) and "a new version is available"
 * (the user decides when to reload — updates are never forced mid-session).
 */
export function ReloadPrompt() {
  const { t } = useTranslation();
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!offlineReady && !needRefresh) return null;

  return (
    <div
      role="status"
      data-testid="pwa-toast"
      className="fixed right-4 bottom-4 z-50 flex max-w-sm flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-lg"
    >
      <p className="flex items-start gap-2 text-sm">
        {needRefresh ? (
          <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        ) : (
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        )}
        {needRefresh ? t('common.pwa.updateAvailable') : t('common.pwa.offlineReady')}
      </p>
      <div className="flex items-center gap-2">
        {needRefresh && (
          <Button size="sm" onClick={() => void updateServiceWorker(true)}>
            {t('common.pwa.reload')}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setOfflineReady(false);
            setNeedRefresh(false);
          }}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          {t('common.pwa.dismiss')}
        </Button>
      </div>
    </div>
  );
}
