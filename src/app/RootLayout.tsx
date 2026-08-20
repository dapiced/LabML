import { Outlet } from 'react-router';
import { Footer } from '@/app/Footer';
import { Header } from '@/app/Header';

export function RootLayout() {
  return (
    <div className="flex min-h-full flex-col">
      <Header />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
