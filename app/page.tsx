'use client';
import dynamic from 'next/dynamic';

const TrackPlayer = dynamic(() => import('@/components/TrackPlayer'), {
  ssr: false,
  loading: () => <div className="grid h-dvh place-items-center text-slate-300">Memuat peta…</div>,
});

export default function Page() {
  return <TrackPlayer />;
}
