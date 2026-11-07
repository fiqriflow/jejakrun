export type Pt = { lat: number; lon: number; ele: number; t: number; d: number; g: number; v: number; b: number };
export type Track = { name: string; pts: Pt[]; dist: number; dur: number; gain: number; vlo: number; vhi: number };
export type Cur = { i: number; lat: number; lon: number; d: number; g: number; v: number; ele: number; b: number };

const R = 6371000;
const rad = Math.PI / 180;

export function hav(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const dl = (b.lat - a.lat) * rad, dn = (b.lon - a.lon) * rad;
  const x = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function bearing(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const dn = (b.lon - a.lon) * rad;
  const y = Math.sin(dn) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos(dn);
  return ((Math.atan2(y, x) / rad) + 360) % 360;
}

/** Interpolasi sudut lewat jalur terpendek. */
export function lerpAngle(a: number, b: number, f: number) {
  const d = ((b - a + 540) % 360) - 180;
  return a + d * f;
}

export function parseGpx(text: string): Track {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('File bukan GPX yang valid.');
  const name = doc.getElementsByTagName('name')[0]?.textContent?.trim() ?? '';
  let els = Array.from(doc.getElementsByTagName('trkpt'));
  if (!els.length) els = Array.from(doc.getElementsByTagName('rtept'));
  if (els.length < 2) throw new Error('Tidak ada titik rute (trkpt) di file ini.');

  let hasT = true;
  const raw: { lat: number; lon: number; ele: number; t: number }[] = [];
  for (const e of els) {
    const lat = parseFloat(e.getAttribute('lat') ?? ''), lon = parseFloat(e.getAttribute('lon') ?? '');
    if (isNaN(lat) || isNaN(lon)) continue;
    const t = Date.parse(e.getElementsByTagName('time')[0]?.textContent ?? '');
    if (isNaN(t)) hasT = false;
    raw.push({ lat, lon, ele: parseFloat(e.getElementsByTagName('ele')[0]?.textContent ?? '0') || 0, t });
  }
  if (raw.length < 2) throw new Error('Titik rute terlalu sedikit.');
  if (!hasT || raw[raw.length - 1].t <= raw[0].t) raw.forEach((p, i) => (p.t = i * 1000));
  const t0 = raw[0].t;

  const step = Math.max(1, Math.ceil(raw.length / 2000));
  const src = raw.filter((_, i) => i % step === 0 || i === raw.length - 1);
  const pts: Pt[] = src.map((p) => ({ ...p, t: (p.t - t0) / 1000, d: 0, g: 0, v: 0, b: 0 }));

  let d = 0, g = 0;
  for (let i = 1; i < pts.length; i++) {
    d += hav(pts[i - 1], pts[i]);
    const de = pts[i].ele - pts[i - 1].ele;
    if (de > 0.5) g += de;
    pts[i].d = d;
    pts[i].g = g;
  }
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 3), z = Math.min(n - 1, i + 3), dt = pts[z].t - pts[a].t;
    pts[i].v = dt > 0 ? (pts[z].d - pts[a].d) / dt : 0;
    let j = i;
    while (j < n - 1 && pts[j].d - pts[i].d < 40) j++;
    pts[i].b = j > i ? bearing(pts[i], pts[j]) : i > 0 ? pts[i - 1].b : 0;
  }
  const s = pts.map((p) => p.v).sort((x, y) => x - y);
  const vlo = s[Math.floor(n * 0.1)], vhi = s[Math.floor(n * 0.9)];
  return { name, pts, dist: d, dur: pts[n - 1].t, gain: g, vlo, vhi: vhi > vlo ? vhi : vlo + 1 };
}

export function at(tr: Track, tt: number): Cur {
  const p = tr.pts;
  let lo = 0, hi = p.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (p[m].t <= tt) lo = m; else hi = m;
  }
  const a = p[lo], b = p[Math.min(lo + 1, p.length - 1)];
  const f = b.t > a.t ? Math.max(0, Math.min(1, (tt - a.t) / (b.t - a.t))) : 0;
  const l = (x: number, y: number) => x + (y - x) * f;
  return { i: lo, lat: l(a.lat, b.lat), lon: l(a.lon, b.lon), d: l(a.d, b.d), g: l(a.g, b.g), v: l(a.v, b.v), ele: l(a.ele, b.ele), b: a.b };
}

export function speedColor(v: number, tr: Track) {
  const s = Math.max(0, Math.min(1, (v - tr.vlo) / (tr.vhi - tr.vlo)));
  return `hsl(${Math.round(210 - 190 * s)}, 85%, 48%)`;
}

export function fmtT(sec: number) {
  const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), c = s % 60;
  const p = (x: number) => String(x).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(c)}` : `${m}:${p(c)}`;
}
export function fmtPace(secPerKm: number) {
  if (!isFinite(secPerKm) || secPerKm <= 0 || secPerKm > 3600) return '–';
  return `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, '0')}`;
}

export function demoGpx() {
  let s = '<gpx><trk><name>Lari pagi (contoh)</name><trkseg>';
  const n = 700, la = -7.3274, lo = 108.2207;
  let t = Date.UTC(2026, 10, 7, 6, 0, 0);
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2, r = 0.012 + 0.004 * Math.sin(3 * a) + 0.002 * Math.cos(5 * a);
    const lat = la + r * Math.sin(a) * 0.9, lon = lo + r * Math.cos(a) * 1.3 + 0.003 * Math.sin(2 * a);
    t += (2.4 + 1.2 * Math.sin(4 * a + 1)) * 1600;
    s += `<trkpt lat="${lat}" lon="${lon}"><ele>${(380 + 25 * Math.sin(2 * a)).toFixed(1)}</ele><time>${new Date(t).toISOString()}</time></trkpt>`;
  }
  return s + '</trkseg></trk></gpx>';
}
