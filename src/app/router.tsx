import { createBrowserRouter } from 'react-router';
import { NotFoundPage } from '@/app/NotFoundPage';
import { RootLayout } from '@/app/RootLayout';
import { HomePage } from '@/features/home/HomePage';

export const router = createBrowserRouter([
  {
    path: '/',
    Component: RootLayout,
    children: [
      { index: true, Component: HomePage },
      {
        path: 'ml',
        lazy: async () => ({ Component: (await import('@/features/ml/pages/MlHomePage')).default }),
      },
      {
        path: 'data',
        lazy: async () => ({ Component: (await import('@/features/data/DataPage')).default }),
      },
      {
        path: 'ai',
        lazy: async () => ({ Component: (await import('@/features/ai/AiPage')).default }),
      },
      { path: '*', Component: NotFoundPage },
    ],
  },
]);
