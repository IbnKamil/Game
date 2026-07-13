/** Topographic elevation helpers for the hex map. */

/** Multi-octave value noise in axial hex space → height in [0, 1]. */
export function hexElevation(q: number, r: number, seed: number): number {
  let amp = 1;
  let freq = 0.11;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < 4; o++) {
    sum += amp * valueNoise2D(q * freq, r * freq, seed + o * 1013);
    norm += amp;
    amp *= 0.52;
    freq *= 2.05;
  }
  let h = sum / norm;
  // Soft continental bias: higher toward map center
  const dist = Math.sqrt(q * q + r * r + q * r);
  h = h * 0.82 + (1 - Math.min(1, dist / 18)) * 0.18;
  return clamp01(h);
}

function valueNoise2D(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = hash2(x0, y0, seed);
  const n10 = hash2(x0 + 1, y0, seed);
  const n01 = hash2(x0, y0 + 1, seed);
  const n11 = hash2(x0 + 1, y0 + 1, seed);
  const ix0 = n00 + (n10 - n00) * sx;
  const ix1 = n01 + (n11 - n01) * sx;
  return ix0 + (ix1 - ix0) * sy;
}

function hash2(x: number, y: number, seed: number): number {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + seed * 1442695041;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export function elevationBand(elevation: number, bands = 8): number {
  return Math.min(bands - 1, Math.max(0, Math.floor(elevation * bands)));
}

/** Classic hypsometric tint (low green → high brown). */
export function topoColor(elevation: number): string {
  const stops: Array<[number, [number, number, number]]> = [
    [0.0, [92, 140, 110]],
    [0.18, [120, 158, 98]],
    [0.35, [168, 186, 96]],
    [0.5, [210, 196, 110]],
    [0.65, [196, 158, 96]],
    [0.8, [168, 122, 84]],
    [1.0, [214, 206, 196]],
  ];
  let i = 0;
  while (i < stops.length - 1 && elevation > stops[i + 1]![0]) i += 1;
  const a = stops[i]!;
  const b = stops[Math.min(i + 1, stops.length - 1)]!;
  const span = Math.max(1e-6, b[0] - a[0]);
  const t = clamp01((elevation - a[0]) / span);
  const rgb = mixRgb(a[1], b[1], t);
  return rgbToHex(rgb);
}

/** Mix owner/neutral color onto topo base so both read clearly. */
export function topoWithOwner(elevation: number, ownerColor: string | null, owned: boolean): string {
  const base = hexToRgb(topoColor(elevation));
  if (!ownerColor) {
    return rgbToHex(base);
  }
  const own = hexToRgb(ownerColor);
  // Owned: stronger political tint; neutral: keep topo dominant
  const t = owned ? 0.42 : 0.12;
  return rgbToHex(mixRgb(base, own, t));
}

export function shadeRgbHex(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex([
    clampByte(r + amt),
    clampByte(g + amt),
    clampByte(b + amt),
  ]);
}

function mixRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function hexToRgb(hex: string): [number, number, number] {
  const raw = hex.replace('#', '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return [109, 128, 114];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => clampByte(v).toString(16).padStart(2, '0')).join('')}`;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}
