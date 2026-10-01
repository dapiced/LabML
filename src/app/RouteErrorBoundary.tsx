import { useRouteError } from 'react-router';
import { ErrorRecovery } from '@/app/ErrorBoundary';

function routeError(value: unknown): Error {
  return value instanceof Error ? value : new Error('RouteError');
}

function RouteErrorRecovery({ scope }: { scope: 'app' | 'section' }) {
  const error = routeError(useRouteError());

  return (
    <ErrorRecovery
      error={error}
      componentStack=""
      scope={scope}
      onRetry={() => window.location.reload()}
      reload
    />
  );
}

export function AppRouteError() {
  return <RouteErrorRecovery scope="app" />;
}

export function SectionRouteError() {
  return <RouteErrorRecovery scope="section" />;
}
