import { createBrowserRouter } from 'react-router';
import { NotFoundPage } from '@/app/NotFoundPage';
import { RootLayout } from '@/app/RootLayout';

export const router = createBrowserRouter([
  {
    path: '/',
    Component: RootLayout,
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
        path: 'privacy',
        lazy: async () => ({
          Component: (await import('@/features/privacy/PrivacyPage')).default,
        }),
      },
      { path: '*', Component: NotFoundPage },
    ],
  },
]);
