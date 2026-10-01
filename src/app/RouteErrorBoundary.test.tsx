import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Link,
  Outlet,
  RouterProvider,
  createMemoryRouter,
  useLocation,
  type RouteObject,
} from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { AppRouteError, SectionRouteError } from '@/app/RouteErrorBoundary';
import { appRoutes } from '@/app/router';
import '@/lib/i18n';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, vi.fn()],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: vi.fn(),
  }),
}));

describe('route error recovery', () => {
  it('installs app and section recovery at the correct router levels', () => {
    expect(appRoutes[0].ErrorBoundary).toBe(AppRouteError);
    expect(appRoutes[0].children?.[0].ErrorBoundary).toBe(SectionRouteError);
  });

  it('contains a failed lazy route without exposing its error details', async () => {
    const routes: RouteObject[] = [
      {
        path: '/',
        Component: () => (
          <>
            <nav>Navigation remains</nav>
            <Outlet />
          </>
        ),
        ErrorBoundary: AppRouteError,
        children: [
          {
            Component: Outlet,
            ErrorBoundary: SectionRouteError,
            children: [
              {
                path: 'broken',
                lazy: async () => {
                  throw new Error('sensitive lazy failure');
                },
              },
            ],
          },
        ],
      },
    ];
    const router = createMemoryRouter(routes, { initialEntries: ['/broken'] });

    render(<RouterProvider router={router} />);

    expect(await screen.findByText('Navigation remains')).toBeInTheDocument();
    expect(await screen.findByText('This section stopped')).toBeInTheDocument();
    expect(screen.queryByText(/sensitive lazy failure/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload LabML' })).toBeInTheDocument();
  });

  it('replaces a failed root layout without exposing the router default error page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const router = createMemoryRouter(
      [
        {
          path: '/',
          Component: () => {
            throw new Error('sensitive root failure');
          },
          ErrorBoundary: AppRouteError,
        },
      ],
      { initialEntries: ['/'] },
    );

    render(<RouterProvider router={router} />);

    expect(await screen.findByText('LabML stopped before the page could open')).toBeInTheDocument();
    expect(screen.queryByText(/sensitive root failure/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/unexpected application error/i)).not.toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('clears a failed React section boundary when navigation changes the pathname', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Shell() {
      const { pathname } = useLocation();
      return (
        <>
          <Link to="/good">Open working section</Link>
          <ErrorBoundary key={pathname} scope="section">
            <Outlet />
          </ErrorBoundary>
        </>
      );
    }
    const router = createMemoryRouter(
      [
        {
          path: '/',
          Component: Shell,
          children: [
            {
              path: 'broken',
              Component: () => {
                throw new Error('broken section');
              },
            },
            { path: 'good', Component: () => <h1>Working section</h1> },
          ],
        },
      ],
      { initialEntries: ['/broken'] },
    );

    render(<RouterProvider router={router} />);
    expect(await screen.findByText('This section stopped')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Open working section' }));

    expect(await screen.findByRole('heading', { name: 'Working section' })).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
