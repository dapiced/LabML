import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { router } from '@/app/router';
import '@/lib/i18n';
import '@/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary scope="app">
      <RouterProvider router={router} />
    </ErrorBoundary>
  </StrictMode>,
);
