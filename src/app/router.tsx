import { createBrowserRouter } from 'react-router';
import { NotFoundPage } from '@/app/NotFoundPage';
import { RootLayout } from '@/app/RootLayout';

/**
 * V35 — react-router warned « No `HydrateFallback` element provided to render
 * during initial hydration » on every route, in every viewport: the router has
 * lazy children, so it starts uninitialized and wants to be told what to paint
 * for the frame before the first route module resolves.
 *
 * It paints nothing, deliberately. Every section already ships a prerendered
 * static shell (V14) and the measured Cumulative Layout Shift is 0 to 0.007 —
 * a spinner or a skeleton here would be a visible element appearing and
 * vanishing within one frame, which is how a good CLS becomes a bad one. So
 * the fallback declares the behaviour the app already had, rather than adding
 * one; what changes is that the console stops saying so on every page load.
 *
 * Written inline rather than as a named component: this file exports a router,
 * not components, and a `const HydrateFallback = () => null` beside it is
 * enough for react-refresh to call the module mixed and warn about it. Adding
 * a lint warning while closing a console warning would be a poor trade.
 */
export const router = createBrowserRouter([
  {
    path: '/',
    Component: RootLayout,
    HydrateFallback: () => null,
    children: [
      {
        index: true,
        lazy: async () => ({ Component: (await import('@/features/home/HomePage')).default }),
      },
      {
        path: 'ml',
        lazy: async () => ({ Component: (await import('@/features/ml/pages/MlHomePage')).default }),
      },
      {
        path: 'ml/run/:id',
        lazy: async () => ({
          Component: (await import('@/features/ml/pages/StoredRunPage')).default,
        }),
      },
      {
        path: 'ml/compare/:a/:b',
        lazy: async () => ({
          Component: (await import('@/features/ml/pages/MlComparePage')).default,
        }),
      },
      {
        path: 'ml/compare-many/:ids',
        lazy: async () => ({
          Component: (await import('@/features/ml/pages/MlCompareManyPage')).default,
        }),
      },
      {
        path: 'ml/share',
        lazy: async () => ({
          Component: (await import('@/features/ml/pages/SharedRunPage')).default,
        }),
      },
      {
        path: 'data',
        lazy: async () => ({ Component: (await import('@/features/data/DataPage')).default }),
      },
      {
        path: 'ai',
        lazy: async () => ({ Component: (await import('@/features/ai/AiPage')).default }),
      },
      {
        path: 'ai/vision',
        lazy: async () => ({
          Component: (await import('@/features/ai/vision/VisionPage')).default,
        }),
      },
      {
        path: 'ai/chat',
        lazy: async () => ({
          Component: (await import('@/features/ai/chat/ChatPage')).default,
        }),
      },
      {
        path: 'about',
        lazy: async () => ({ Component: (await import('@/features/about/AboutPage')).default }),
      },
      {
        path: 'docs',
        lazy: async () => ({ Component: (await import('@/features/docs/DocsPage')).default }),
      },
      {
        path: 'docs/:slug',
        lazy: async () => ({ Component: (await import('@/features/docs/DocsPage')).default }),
      },
      {
        path: 'privacy',
        lazy: async () => ({
          Component: (await import('@/features/privacy/PrivacyPage')).default,
        }),
      },
      { path: '*', Component: NotFoundPage },
    ],
  },
]);
