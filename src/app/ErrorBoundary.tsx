import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { Copy, House, RotateCcw, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { buildErrorReport } from '@/app/errorReport';

interface BoundaryProps {
  children: ReactNode;
  scope: 'app' | 'section';
}

interface BoundaryState {
  error: Error | null;
  componentStack: string;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export function ErrorRecovery({
  error,
  componentStack,
  scope,
  onRetry,
  reload = false,
}: {
  error: Error;
  componentStack: string;
  scope: BoundaryProps['scope'];
  onRetry: () => void;
  reload?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  const report = useMemo(
    () =>
      buildErrorReport({
        error,
        componentStack,
        scope,
        pathname: window.location.pathname,
        language: i18n.language,
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString(),
        version: __APP_VERSION__,
      }),
    [componentStack, error, i18n.language, scope],
  );

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  return (
    <section
      role="alert"
      className={`grid place-items-center px-5 py-12 ${scope === 'app' ? 'min-h-screen bg-bg' : 'min-h-[55vh]'}`}
    >
      <div className="w-full max-w-2xl">
        <TriangleAlert aria-hidden="true" className="mb-6 size-9 text-copper" strokeWidth={1.8} />
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="max-w-xl font-display text-3xl leading-tight font-bold tracking-[-0.025em] text-balance outline-none sm:text-4xl"
        >
          {t(`common.errorBoundary.${scope}.title`)}
        </h1>
        <p className="mt-4 max-w-[65ch] text-base leading-7 text-muted">
          {t(`common.errorBoundary.${scope}.body`)}
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button onClick={onRetry}>
            <RotateCcw aria-hidden="true" className="size-4" />
            {t(reload ? 'common.errorBoundary.reload' : 'common.errorBoundary.retry')}
          </Button>
          <a
            href="/"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-line bg-surface px-5 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
          >
            <House aria-hidden="true" className="size-4" />
            {t('common.errorBoundary.home')}
          </a>
        </div>

        <div className="mt-10 border-t border-line pt-6">
          <p className="max-w-[65ch] text-sm leading-6 text-muted">
            {t('common.errorBoundary.reportPrivacy')}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => void copyReport()}>
              <Copy aria-hidden="true" className="size-4" />
              {t('common.errorBoundary.copy')}
            </Button>
            <span aria-live="polite" className="text-sm text-muted">
              {copyState === 'copied' && t('common.errorBoundary.copied')}
              {copyState === 'failed' && t('common.errorBoundary.copyFailed')}
            </span>
          </div>
          <details className="mt-4">
            <summary className="w-fit cursor-pointer text-sm font-medium text-accent-strong underline decoration-line underline-offset-4">
              {t('common.errorBoundary.showReport')}
            </summary>
            <pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-surface-2 p-4 font-mono text-xs leading-5 whitespace-pre-wrap text-ink">
              {report}
            </pre>
          </details>
        </div>
      </div>
    </section>
  );
}

export class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, componentStack: '' };

  static getDerivedStateFromError(value: unknown): Partial<BoundaryState> {
    return { error: toError(value) };
  }

  componentDidCatch(_error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? '' });
  }

  private retry = () => {
    this.setState({ error: null, componentStack: '' });
  };

  render() {
    if (this.state.error) {
      return (
        <ErrorRecovery
          error={this.state.error}
          componentStack={this.state.componentStack}
          scope={this.props.scope}
          onRetry={this.retry}
        />
      );
    }
    return this.props.children;
  }
}
