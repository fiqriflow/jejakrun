import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Jejak — animasi rute GPX',
  description: 'Ubah file GPX Strava jadi animasi rute dan video.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="bg-slate-900 antialiased">{children}</body>
    </html>
  );
}
