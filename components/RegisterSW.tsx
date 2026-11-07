'use client';
import { useEffect, useState } from 'react';

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export default function RegisterSW() {
  const [evt, setEvt] = useState<InstallEvent | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as InstallEvent); };
    const onInstalled = () => setEvt(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!evt) return null;
  return (
    <button
      className="fixed right-3 top-3 z-20 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-lg"
      style={{ marginTop: 'env(safe-area-inset-top)' }}
      onClick={async () => { await evt.prompt(); await evt.userChoice; setEvt(null); }}
    >
      Pasang aplikasi
    </button>
  );
}
