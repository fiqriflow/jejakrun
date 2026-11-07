import type { Metadata, Viewport } from 'next';
import RegisterSW from '@/components/RegisterSW';
import './globals.css';

export const metadata: Metadata = {
  title: 'Jejak — animasi rute GPX',
  description: 'Ubah file GPX Strava jadi animasi rute dan video.',
  applicationName: 'Jejak',
  appleWebApp: { capable: true, title: 'Jejak', statusBarStyle: 'black-translucent' },
  formatDetection: { telephone: false },
};
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0f172a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="bg-slate-900 antialiased">
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
