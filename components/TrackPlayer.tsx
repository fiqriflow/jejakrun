'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { at, demoGpx, fmtPace, fmtT, lerpAngle, parseGpx, speedColor, type Cur, type Track } from '@/lib/gpx';

const DUR = 30000; // ms animasi pada 1×
const SPEEDS = [1, 2, 4, 8];
const EMPTY = { type: 'FeatureCollection' as const, features: [] };

type Cam = { lng: number; lat: number; zoom: number; bearing: number; pitch: number; pad: number };
type Hud = { d: number; t: number; v: number; g: number };
type St = {
  P: number; playing: boolean; mult: number; follow: boolean; last: number; idx: number;
  cam: Cam | null; ov: Cam | null; hud: Hud; exp: { hold: number; finish: () => void } | null;
};

function mapStyle(): string | maplibregl.StyleSpecification {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  if (key) return `https://api.maptiler.com/maps/streets-v2/style.json?key=${key}`;
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19,
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  };
}

/** Target kamera: mode ikuti = gaya navigasi Google Maps (miring, searah gerak, titik di bawah tengah). */
function camTarget(s: St, cur: Cur): Cam | null {
  if (s.follow) {
    return { lng: cur.lon, lat: cur.lat, zoom: 17.3 - Math.min(1.3, Math.max(0, cur.v - 2) * 0.2), bearing: cur.b, pitch: 62, pad: 0.3 };
  }
  return s.ov;
}

function drawHud(c: CanvasRenderingContext2D, h: Hud, name: string) {
  const items: [string, string][] = [
    [(h.d / 1000).toFixed(2).replace('.', ','), 'km'],
    [fmtT(h.t), 'waktu'],
    [h.v > 0.3 ? fmtPace(1000 / h.v) : '–', 'menit/km'],
    [String(Math.round(h.g)), 'm naik'],
  ];
  const x = 40, y = 40, oy = name ? 36 : 0;
  c.fillStyle = 'rgba(15,23,42,.82)';
  c.beginPath();
  c.roundRect(x, y, 780, 120 + oy, 24);
  c.fill();
  c.fillStyle = '#fff';
  if (name) { c.font = '700 30px system-ui, sans-serif'; c.fillText(name.slice(0, 42), x + 28, y + 50); }
  items.forEach((it, i) => {
    c.fillStyle = '#fff'; c.font = '700 46px system-ui, sans-serif'; c.fillText(it[0], x + 28 + i * 190, y + oy + 74);
    c.fillStyle = '#94a3b8'; c.font = '24px system-ui, sans-serif'; c.fillText(it[1], x + 28 + i * 190, y + oy + 104);
  });
}

export default function TrackPlayer() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const trackRef = useRef<Track | null>(null);
  const S = useRef<St>({
    P: 0, playing: false, mult: 1, follow: true, last: 0, idx: -1,
    cam: null, ov: null, hud: { d: 0, t: 0, v: 0, g: 0 }, exp: null,
  });
  const [track, setTrack] = useState<Track | null>(null);
  const [ready, setReady] = useState(false);
  const [ui, setUi] = useState({ ...S.current.hud, P: 0 });
  const [playing, setPlaying] = useState(false);
  const [follow, setFollow] = useState(true);
  const [mult, setMult] = useState(1);
  const [msg, setMsg] = useState('');
  const [pct, setPct] = useState<number | null>(null);

  const calcOv = useCallback(() => {
    const map = mapRef.current, tr = trackRef.current;
    if (!map || !tr) return;
    const b = new maplibregl.LngLatBounds();
    tr.pts.forEach((p) => b.extend([p.lon, p.lat]));
    const c = map.cameraForBounds(b, { padding: { top: 70, bottom: 70, left: 40, right: 40 } });
    if (c && c.center) {
      const ll = maplibregl.LngLat.convert(c.center);
      S.current.ov = { lng: ll.lng, lat: ll.lat, zoom: c.zoom ?? 12, bearing: 0, pitch: 0, pad: 0 };
    }
  }, []);

  // init peta
  useEffect(() => {
    const map = new maplibregl.Map({
      container: boxRef.current!, style: mapStyle(), center: [110, -2], zoom: 4,
      attributionControl: { compact: true }, canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    mapRef.current = map;
    const el = document.createElement('div');
    el.style.cssText = 'display:none;width:22px;height:22px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 6px rgba(37,99,235,.25),0 2px 6px rgba(0,0,0,.4)';
    markerRef.current = new maplibregl.Marker({ element: el }).setLngLat([0, 0]).addTo(map);
    const line = { 'line-cap': 'round' as const, 'line-join': 'round' as const };
    map.on('load', () => {
      map.addSource('route', { type: 'geojson', data: EMPTY });
      map.addSource('trail', { type: 'geojson', data: EMPTY });
      map.addSource('head', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: line, paint: { 'line-color': '#fff', 'line-width': 10, 'line-opacity': 0.85 } });
      map.addLayer({ id: 'route', type: 'line', source: 'route', layout: line, paint: { 'line-color': '#94a3b8', 'line-width': 5 } });
      map.addLayer({ id: 'trail', type: 'line', source: 'trail', layout: line, filter: ['<=', ['get', 'i'], -1], paint: { 'line-color': ['get', 'c'], 'line-width': 6 } });
      map.addLayer({ id: 'head', type: 'line', source: 'head', layout: line, paint: { 'line-color': ['get', 'c'], 'line-width': 6 } });
      setReady(true);
    });
    map.on('resize', calcOv);
    return () => { map.remove(); mapRef.current = null; setReady(false); };
  }, [calcOv]);

  // track baru
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !track) return;
    const coords = track.pts.map((p) => [p.lon, p.lat]);
    (map.getSource('route') as maplibregl.GeoJSONSource).setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
    const segs: GeoJSON.Feature[] = [];
    for (let i = 1; i < coords.length; i++) {
      segs.push({ type: 'Feature', properties: { i, c: speedColor(track.pts[i].v, track) }, geometry: { type: 'LineString', coordinates: [coords[i - 1], coords[i]] } });
    }
    (map.getSource('trail') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: segs });
    (map.getSource('head') as maplibregl.GeoJSONSource).setData(EMPTY);
    map.setFilter('trail', ['<=', ['get', 'i'], -1]);
    markerRef.current!.getElement().style.display = 'block';
    calcOv();
    const s = S.current;
    s.P = 0; s.idx = -1; s.playing = false; s.last = 0; s.exp = null;
    s.cam = s.ov ? { ...s.ov } : null; // mulai dari overview, lalu terbang masuk ke mode ikuti
    if (s.cam) map.jumpTo({ center: [s.cam.lng, s.cam.lat], zoom: s.cam.zoom, bearing: 0, pitch: 0 });
    setPlaying(false);
    const id = setTimeout(() => { s.playing = true; setPlaying(true); }, 800);
    return () => clearTimeout(id);
  }, [track, ready, calcOv]);

  // loop animasi
  useEffect(() => {
    let raf = 0, lastUi = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const map = mapRef.current, tr = trackRef.current, s = S.current;
      if (!map || !tr || !map.getSource('head')) return;
      const dt = s.last ? Math.min((now - s.last) / 1000, 0.1) : 0;
      s.last = now;
      if (s.playing) {
        s.P = Math.min(1, s.P + (dt * 1000 / DUR) * s.mult);
        if (s.P >= 1) { s.playing = false; setPlaying(false); }
      }
      const cur = at(tr, s.P * tr.dur);
      if (cur.i !== s.idx) { s.idx = cur.i; map.setFilter('trail', ['<=', ['get', 'i'], cur.i]); }
      const a0 = tr.pts[cur.i];
      (map.getSource('head') as maplibregl.GeoJSONSource).setData({
        type: 'Feature', properties: { c: speedColor(cur.v, tr) },
        geometry: { type: 'LineString', coordinates: [[a0.lon, a0.lat], [cur.lon, cur.lat]] },
      });
      markerRef.current?.setLngLat([cur.lon, cur.lat]);

      const cam = s.cam, t = camTarget(s, cur);
      if (cam && t) {
        const k = 1 - Math.exp(-dt * 3.2), kb = 1 - Math.exp(-dt * 2);
        cam.lng += (t.lng - cam.lng) * k; cam.lat += (t.lat - cam.lat) * k;
        cam.zoom += (t.zoom - cam.zoom) * k; cam.pitch += (t.pitch - cam.pitch) * k; cam.pad += (t.pad - cam.pad) * k;
        cam.bearing = lerpAngle(cam.bearing, t.bearing, kb);
        map.jumpTo({
          center: [cam.lng, cam.lat], zoom: cam.zoom, bearing: cam.bearing, pitch: cam.pitch,
          padding: { top: map.getContainer().clientHeight * cam.pad, bottom: 0, left: 0, right: 0 },
        });
      }
      s.hud = { d: cur.d, t: s.P * tr.dur, v: cur.v, g: cur.g };
      if (now - lastUi > 100) {
        lastUi = now; setUi({ ...s.hud, P: s.P });
        if (s.exp) setPct(Math.round(s.P * 100));
      }
      if (s.exp) {
        map.triggerRepaint();
        if (s.P >= 1) { s.exp.hold -= dt; if (s.exp.hold <= 0) s.exp.finish(); }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const loadText = (text: string) => {
    try { const tr = parseGpx(text); trackRef.current = tr; setTrack(tr); setMsg(''); }
    catch (e) { setMsg((e as Error).message); }
  };
  const readFile = (f?: File) => { if (f) f.text().then(loadText).catch(() => setMsg('Gagal membaca file.')); };

  const togglePlay = () => {
    const s = S.current;
    if (s.P >= 1) { s.P = 0; s.idx = -1; }
    s.playing = !s.playing; setPlaying(s.playing);
  };
  const toggleFollow = () => { S.current.follow = !S.current.follow; setFollow(S.current.follow); };
  const cycleSpeed = () => { const m = SPEEDS[(SPEEDS.indexOf(S.current.mult) + 1) % SPEEDS.length]; S.current.mult = m; setMult(m); };

  const doExport = async () => {
    const map = mapRef.current, tr = trackRef.current, wrap = wrapRef.current, s = S.current;
    if (!map || !tr || !wrap || s.exp) return;
    const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    const mime = typeof MediaRecorder === 'undefined' ? undefined : types.find((t) => MediaRecorder.isTypeSupported(t));
    if (!mime) { setMsg('Browser ini tidak mendukung perekaman video.'); return; }
    s.playing = false; setPlaying(false); setPct(0); setMsg('');
    // paksa kanvas peta ke 1920×1080 (ditampilkan diperkecil di layar)
    const k = Math.min(window.innerWidth / 1920, (window.innerHeight - 70) / 1080, 1);
    Object.assign(wrap.style, {
      position: 'fixed', inset: 'auto', left: '0', top: '60px', width: '1920px', height: '1080px',
      zIndex: '60', transformOrigin: '0 0', transform: `scale(${k})`,
    });
    map.setPixelRatio(1); map.resize();
    s.P = 0; s.idx = -1;
    const c0 = at(tr, 0), t0 = camTarget(s, c0);
    if (t0) s.cam = { ...t0 };
    await new Promise<void>((r) => { const to = setTimeout(r, 5000); map.once('idle', () => { clearTimeout(to); r(); }); });

    const comp = document.createElement('canvas');
    comp.width = 1920; comp.height = 1080;
    const c = comp.getContext('2d')!;
    const paint = () => { c.drawImage(map.getCanvas(), 0, 0, 1920, 1080); drawHud(c, s.hud, tr.name); };
    map.on('render', paint);
    const rec = new MediaRecorder(comp.captureStream(30), { mimeType: mime, videoBitsPerSecond: 12_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      map.off('render', paint);
      wrap.style.cssText = '';
      map.setPixelRatio(window.devicePixelRatio); map.resize();
      setPct(null);
      const url = URL.createObjectURL(new Blob(chunks, { type: mime.split(';')[0] }));
      const a = document.createElement('a');
      a.href = url; a.download = `jejak.${mime.includes('mp4') ? 'mp4' : 'webm'}`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    };
    s.exp = { hold: 1.5, finish: () => { s.exp = null; rec.stop(); } };
    paint(); rec.start();
    s.playing = true; setPlaying(true);
  };

  const btn = 'rounded-lg border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-40';
  const stats: [string, string][] = [
    [(ui.d / 1000).toFixed(2).replace('.', ','), 'Jarak (km)'],
    [fmtT(ui.t), 'Waktu'],
    [ui.v > 0.3 ? fmtPace(1000 / ui.v) : '–', 'Pace (menit/km)'],
    [String(Math.round(ui.g)), 'Naik (m)'],
  ];

  return (
    <div
      className="relative flex h-dvh w-full flex-col overflow-hidden bg-slate-900 text-slate-100"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); readFile(e.dataTransfer.files[0]); }}
    >
      <div className="relative min-h-0 flex-1">
        <div ref={wrapRef} className="absolute inset-0">
          <div ref={boxRef} className="h-full w-full" />
        </div>
        {!track && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-slate-900/85 p-6 text-center">
            <h1 className="text-3xl font-bold tracking-tight">Jejak</h1>
            <p className="max-w-sm text-slate-300">Tarik file .gpx ke sini. Di Strava: buka aktivitas, titik tiga, Export GPX. File diproses di browser.</p>
            <div className="flex flex-wrap justify-center gap-2">
              <label className="cursor-pointer rounded-lg bg-white px-4 py-2 font-medium text-slate-900">
                Pilih file GPX
                <input type="file" accept=".gpx,application/gpx+xml,text/xml" className="hidden" onChange={(e) => readFile(e.target.files?.[0])} />
              </label>
              <button className={btn} disabled={!ready} onClick={() => loadText(demoGpx())}>Coba rute contoh</button>
            </div>
            {msg && <p className="text-sm text-red-400">{msg}</p>}
          </div>
        )}
        {track && track.name && (
          <div className="absolute left-3 top-3 z-10 max-w-[70%] truncate rounded-xl bg-slate-900/80 px-3 py-2 text-sm backdrop-blur">{track.name}</div>
        )}
      </div>

      {track && (
        <div className="z-10 border-t border-slate-800 bg-slate-900 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mb-3 grid grid-cols-4 gap-2">
            {stats.map(([v, l]) => (
              <div key={l} className="rounded-lg bg-slate-800 px-2 py-2">
                <b className="block text-lg tabular-nums sm:text-2xl">{v}</b>
                <span className="text-xs text-slate-400">{l}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className={`${btn} bg-white text-slate-900 hover:bg-slate-200`} onClick={togglePlay}>
              {playing ? 'Jeda' : ui.P >= 1 ? 'Ulangi' : 'Putar'}
            </button>
            <input
              type="range" min={0} max={1000} value={Math.round(ui.P * 1000)} aria-label="Posisi"
              className="min-w-32 flex-1 accent-orange-500"
              onChange={(e) => { S.current.P = Number(e.target.value) / 1000; S.current.playing = false; setPlaying(false); }}
            />
            <button className={btn} onClick={cycleSpeed}>{mult}×</button>
            <button className={btn} onClick={toggleFollow}>{follow ? 'Kamera: ikuti' : 'Kamera: semua rute'}</button>
            <button className={btn} onClick={doExport}>Ekspor video 1080p</button>
            <label className={`${btn} cursor-pointer`}>
              Ganti file
              <input type="file" accept=".gpx,application/gpx+xml,text/xml" className="hidden" onChange={(e) => readFile(e.target.files?.[0])} />
            </label>
          </div>
          {msg && <p className="mt-2 text-sm text-red-400">{msg}</p>}
        </div>
      )}

      {pct !== null && (
        <>
          <div className="fixed inset-0 z-50 bg-black" />
          <div className="fixed left-0 right-0 top-0 z-[70] flex h-[60px] items-center justify-center text-sm text-slate-200">
            Merekam 1920×1080… {pct}% — jangan pindah tab
          </div>
        </>
      )}
    </div>
  );
}
