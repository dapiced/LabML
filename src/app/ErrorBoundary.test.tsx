import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { buildErrorReport } from '@/app/errorReport';
import '@/lib/i18n';

describe('buildErrorReport', () => {
  it('keeps diagnostics but excludes error text and URL data', () => {
    const report = buildErrorReport({
      error: new Error('secret row value: Alice, 123 Main Street'),
      componentStack:
        '\n    at DatasetView (https://app.test/assets/app.js:12:4)\n    at RootLayout',
      scope: 'section',
      pathname: '/ml/run/local-id',
      language: 'fr',
      userAgent: 'Test browser',
      timestamp: '2026-10-01T16:00:00.000Z',
      version: '1.43.0',
    });

    expect(report).toContain('LabML 1.43.0');
    expect(report).toContain('Route: /ml/run/local-id');
    expect(report).toContain('Error type: Error');
    expect(report).toContain('Components: DatasetView > RootLayout');
    expect(report).not.toContain('Alice');
    expect(report).not.toContain('123 Main Street');
    expect(report).not.toContain('app.js');
  });

  it('bounds and sanitizes a long component stack', () => {
    const componentStack = Array.from(
      { length: 30 },
      (_, index) =>
        `\n    at Component${index} (C:\\Users\\person\\private\\source.tsx:${index}:1)`,
    ).join('');
    const report = buildErrorReport({
      error: new TypeError('private value'),
      componentStack,
      scope: 'app',
      pathname: '/',
      language: 'en',
      userAgent: 'Test browser',
      timestamp: '2026-10-01T16:00:00.000Z',
      version: '1.43.0',
    });

    expect(report).toContain('Error type: TypeError');
    expect(report).toContain('Component11');
    expect(report).not.toContain('Component12');
    expect(report).not.toContain('C:\\Users');
  });
});

describe('ErrorBoundary', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    writeText.mockClear();
  });

  it('replaces a failed section with recovery actions and a privacy-safe report', async () => {
    function BrokenSection(): never {
      throw new Error('dataset value that must not be copied');
    }

    render(
      <ErrorBoundary scope="section">
        <BrokenSection />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('This section stopped');
    expect(screen.getByRole('link', { name: /home/i })).toHaveAttribute('href', '/');
    await userEvent.click(screen.getByRole('button', { name: /copy technical report/i }));

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0][0]).toContain('Scope: section');
    expect(writeText.mock.calls[0][0]).not.toContain('dataset value');
    expect(screen.getByText('Report copied')).toBeInTheDocument();
  });

  it('tries the section again without reloading the application', async () => {
    let broken = true;
    function SometimesBroken() {
      if (broken) throw new Error('first render');
      return <p>Section restored</p>;
    }

    render(
      <ErrorBoundary scope="section">
        <SometimesBroken />
      </ErrorBoundary>,
    );
    broken = false;
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(screen.getByText('Section restored')).toBeInTheDocument();
  });

  it('keeps the report selectable when clipboard access fails', async () => {
    writeText.mockRejectedValueOnce(new Error('clipboard denied'));
    function BrokenSection(): never {
      throw new Error('private cell');
    }

    render(
      <ErrorBoundary scope="section">
        <BrokenSection />
      </ErrorBoundary>,
    );
    await userEvent.click(screen.getByRole('button', { name: /copy technical report/i }));

    expect(screen.getByText(/copy it manually/i)).toBeInTheDocument();
    await userEvent.click(screen.getByText('Show the report'));
    expect(screen.getByText(/Scope: section/)).toBeInTheDocument();
  });
});
