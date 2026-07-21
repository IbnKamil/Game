import { cellKey, type Axial, type MapShapeId } from './types';
import { hexDistance, hexNeighbors } from './hex';

/** Map outline shapes (hex grid masks). Always one walkable landmass. */
export const MAP_SHAPE_PRESETS = [
  {
    id: 'random',
    label: 'Случайная',
    hint: 'Каждая партия — новая необычная связная форма',
  },
  {
    id: 'continent',
    label: 'Континент',
    hint: 'Неровный материк с изрезанным берегом',
  },
  {
    id: 'donut',
    label: 'Кольцо',
    hint: 'Суша вокруг центрального моря (пройти можно вокруг)',
  },
  {
    id: 'crescent',
    label: 'Полумесяц',
    hint: 'Изогнутая дуга суши',
  },
  {
    id: 'lakes',
    label: 'Озёра',
    hint: 'Один материк с внутренними озёрами',
  },
  {
    id: 'corridor',
    label: 'Коридор',
    hint: 'Узкая длинная полоса',
  },
  {
    id: 'star',
    label: 'Звезда',
    hint: 'Лучи от центра',
  },
  {
    id: 'hourglass',
    label: 'Песочные часы',
    hint: 'Два региона, соединённые перешейком',
  },
  {
    id: 'isthmus',
    label: 'Перешеек',
    hint: 'Две части суши, соединённые узким мостом',
  },
  {
    id: 'fjord',
    label: 'Фьорды',
    hint: 'Глубокие заливы и узкие мысы',
  },
  {
    id: 'hex',
    label: 'Шестиугольник',
    hint: 'Классическая круглая карта',
  },
] as const satisfies ReadonlyArray<{ id: MapShapeId; label: string; hint: string }>;

/** Concrete shapes (no "random"). */
export type ConcreteMapShape = Exclude<MapShapeId, 'random' | 'islands' | 'twin'>;

const UNUSUAL_SHAPES: ConcreteMapShape[] = [
  'continent',
  'donut',
  'crescent',
  'lakes',
  'corridor',
  'star',
  'hourglass',
  'isthmus',
  'fjord',
];

export function resolveMapShape(shape: MapShapeId | undefined, rng: () => number): ConcreteMapShape {
  // Menu "random" → unusual; omitted shape (tests / old configs) → classic hex
  if (shape === 'random') {
    return UNUSUAL_SHAPES[Math.floor(rng() * UNUSUAL_SHAPES.length)]!;
  }
  if (!shape) return 'hex';
  // Legacy disconnected shapes → connected replacements
  if (shape === 'islands') return 'lakes';
  if (shape === 'twin') return 'isthmus';
  return shape;
}

/** Build the set of land hex keys for a shape inside a hex disk of `radius`. */
export function buildLandMask(
  shape: ConcreteMapShape,
  radius: number,
  seed: number,
  rng: () => number,
): Set<string> {
  const candidates = listDisk(radius);
  let land: Set<string>;

  switch (shape) {
    case 'hex':
      land = maskHex(candidates, radius, rng);
      break;
    case 'donut':
      land = maskDonut(candidates, radius, rng);
      break;
    case 'crescent':
      land = maskCrescent(candidates, radius, rng);
      break;
    case 'lakes':
      land = maskLakes(candidates, radius, seed, rng);
      break;
    case 'corridor':
      land = maskCorridor(candidates, radius, rng);
      break;
    case 'star':
      land = maskStar(candidates, radius, rng);
      break;
    case 'hourglass':
      land = maskHourglass(candidates, radius, rng);
      break;
    case 'isthmus':
      land = maskIsthmus(candidates, radius, rng);
      break;
    case 'fjord':
      land = maskFjord(candidates, radius, seed, rng);
      break;
    case 'continent':
    default:
      land = maskContinent(candidates, radius, seed, rng);
      break;
  }

  // Always one contiguous landmass — units cannot cross water
  land = keepLargestComponent(land);

  // Safety: never return an empty / tiny map
  if (land.size < Math.max(18, Math.floor(radius * 2.5))) {
    return keepLargestComponent(maskHex(candidates, radius, rng));
  }
  return land;
}

function listDisk(radius: number): Axial[] {
  const out: Axial[] = [];
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) {
      out.push({ q, r });
    }
  }
  return out;
}

function hashNoise(q: number, r: number, seed: number): number {
  let n = Math.imul(q, 374761393) + Math.imul(r, 668265263) + seed * 1442695041;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function softEdge(dist: number, radius: number, rng: () => number, falloff = 1.4): boolean {
  if (dist <= radius - falloff) return true;
  if (dist > radius) return false;
  const t = (radius - dist) / falloff;
  return rng() < 0.35 + t * 0.65;
}

function maskHex(candidates: Axial[], radius: number, rng: () => number): Set<string> {
  const land = new Set<string>();
  for (const { q, r } of candidates) {
    const dist = hexDistance({ q, r }, { q: 0, r: 0 });
    if (!softEdge(dist, radius, rng, 1.2)) continue;
    land.add(cellKey(q, r));
  }
  return land;
}

function maskDonut(candidates: Axial[], radius: number, rng: () => number): Set<string> {
  const inner = Math.max(2, Math.floor(radius * 0.38));
  const land = new Set<string>();
  for (const { q, r } of candidates) {
    const dist = hexDistance({ q, r }, { q: 0, r: 0 });
    if (dist < inner) continue;
    if (dist < inner + 1 && rng() > 0.4) continue;
    if (!softEdge(dist, radius, rng, 1.3)) continue;
    land.add(cellKey(q, r));
  }
  return land;
}

function maskCrescent(candidates: Axial[], radius: number, rng: () => number): Set<string> {
  const ox = Math.floor(radius * 0.55);
  const holeR = radius * 0.72;
  const land = new Set<string>();
  for (const { q, r } of candidates) {
    const dist = hexDistance({ q, r }, { q: 0, r: 0 });
    const distHole = hexDistance({ q, r }, { q: ox, r: -Math.floor(ox * 0.3) });
    if (distHole < holeR) continue;
    if (distHole < holeR + 1.2 && rng() > 0.45) continue;
    if (!softEdge(dist, radius, rng, 1.5)) continue;
    land.add(cellKey(q, r));
  }
  return land;
}

function maskCorridor(candidates: Axial[], radius: number, rng: () => number): Set<string> {
  const halfW = Math.max(1, Math.floor(radius * 0.28));
  const land = new Set<string>();
  for (const { q, r } of candidates) {
    // Elongate along q; allow slight meander via noise on r
    const meander = Math.sin(q * 0.45) * (halfW * 0.35);
    const width = halfW + (rng() > 0.7 ? 1 : 0);
    if (Math.abs(r - meander) > width) continue;
    if (Math.abs(q) > radius) continue;
    // Soft tips
    if (Math.abs(q) > radius - 1.5 && rng() > 0.5) continue;
    land.add(cellKey(q, r));
  }
  return land;
}

function maskStar(candidates: Axial[], radius: number, rng: () => number): Set<string> {
  const armW = Math.max(1, Math.floor(radius * 0.22));
  const land = new Set<string>();
  for (const { q, r } of candidates) {
    const s = -q - r;
    const dist = hexDistance({ q, r }, { q: 0, r: 0 });
    if (dist > radius) continue;
    const onArm =
      Math.abs(q) <= armW ||
      Math.abs(r) <= armW ||
      Math.abs(s) <= armW ||
      Math.abs(q - r) <= armW * 0.85;
    if (!onArm) continue;
    if (dist > radius - 1.2 && rng() > 0.45) continue;
    land.add(cellKey(q, r));
  }
  return land;
}

function maskHourglass(candidates: Axial[], radius: number, rng: () => number): Set<string> {
  const lobe = Math.max(3, Math.floor(radius * 0.55));
  const gap = Math.max(2, Math.floor(radius * 0.42));
  const c1 = { q: 0, r: -gap };
  const c2 = { q: 0, r: gap };
  const land = new Set<string>();
  for (const { q, r } of candidates) {
    const d1 = hexDistance({ q, r }, c1);
    const d2 = hexDistance({ q, r }, c2);
    const inLobe = softEdge(d1, lobe, rng, 1.1) || softEdge(d2, lobe, rng, 1.1);
    // Narrow bridge on the q≈0 axis between lobes
    const onBridge = Math.abs(q) <= Math.max(1, Math.floor(radius * 0.12)) && Math.abs(r) <= gap;
    if (!inLobe && !onBridge) continue;
    if (onBridge && !inLobe && rng() > 0.85) continue;
    land.add(cellKey(q, r));
  }
  return land;
}

function maskIsthmus(candidates: Axial[], radius: number, rng: () => number): Set<string> {
  // Two lobes joined by an explicit land bridge (single walkable mass)
  const lobe = Math.max(3, Math.floor(radius * 0.48));
  const gap = Math.max(3, Math.floor(radius * 0.42));
  const c1 = { q: -gap, r: Math.floor(gap * 0.1) };
  const c2 = { q: gap, r: -Math.floor(gap * 0.1) };
  const bridgeW = Math.max(1, Math.floor(radius * 0.14));
  const land = new Set<string>();
  for (const { q, r } of candidates) {
    const d1 = hexDistance({ q, r }, c1);
    const d2 = hexDistance({ q, r }, c2);
    const inLobe = softEdge(d1, lobe, rng, 1.1) || softEdge(d2, lobe, rng, 1.1);
    const onBridge = Math.abs(r) <= bridgeW && Math.abs(q) <= gap;
    if (!inLobe && !onBridge) continue;
    land.add(cellKey(q, r));
  }
  return land;
}

function maskLakes(
  candidates: Axial[],
  radius: number,
  seed: number,
  rng: () => number,
): Set<string> {
  // One continent with inland water holes — land stays contiguous around lakes
  const land = maskContinent(candidates, radius, seed, rng);
  const lakes = 2 + Math.floor(rng() * 2); // 2–3
  const lakeR = Math.max(1, Math.floor(radius * 0.16));
  for (let i = 0; i < lakes; i++) {
    const ang = (i / lakes) * Math.PI * 2 + rng() * 0.5;
    const rad = radius * (0.22 + rng() * 0.28);
    const cq = Math.round((rad * Math.cos(ang) * 2) / 3);
    const cr = Math.round(rad * Math.sin(ang) / Math.sqrt(3) - cq / 2);
    for (const { q, r } of candidates) {
      if (hexDistance({ q, r }, { q: cq, r: cr }) <= lakeR + hashNoise(q, r, seed + i) * 0.6) {
        land.delete(cellKey(q, r));
      }
    }
  }
  return land;
}

function maskContinent(
  candidates: Axial[],
  radius: number,
  seed: number,
  rng: () => number,
): Set<string> {
  const land = new Set<string>();
  for (const { q, r } of candidates) {
    const dist = hexDistance({ q, r }, { q: 0, r: 0 });
    if (dist > radius) continue;
    // Warped radius: noise pulls the coastline in/out
    const n =
      hashNoise(q, r, seed) * 0.55 +
      hashNoise(Math.floor(q / 2), Math.floor(r / 2), seed + 17) * 0.45;
    const localR = radius * (0.62 + n * 0.48);
    if (dist > localR) continue;
    if (dist > localR - 1.4 && rng() > 0.55) continue;
    land.add(cellKey(q, r));
  }
  return land;
}

function maskFjord(
  candidates: Axial[],
  radius: number,
  seed: number,
  rng: () => number,
): Set<string> {
  // Start from continent, then cut fjord channels from the edge inward
  const land = maskContinent(candidates, radius, seed, rng);
  const channels = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < channels; i++) {
    const angle = (i / channels) * Math.PI * 2 + rng() * 0.4;
    const depth = Math.floor(radius * (0.45 + rng() * 0.35));
    let q = Math.round(((radius - 1) * Math.cos(angle) * 2) / 3);
    let r = Math.round(((radius - 1) * Math.sin(angle)) / Math.sqrt(3) - q / 2);
    for (let step = 0; step < depth; step++) {
      // Carve a 1–2 hex wide channel
      for (const dq of [-1, 0, 1]) {
        for (const dr of [-1, 0, 1]) {
          if (Math.abs(dq) + Math.abs(dr) > 1 && rng() > 0.35) continue;
          land.delete(cellKey(q + dq, r + dr));
        }
      }
      // Step toward center with jitter
      const dirs = hexNeighbors(q, r);
      dirs.sort(
        (a, b) =>
          hexDistance(a, { q: 0, r: 0 }) - hexDistance(b, { q: 0, r: 0 }) || rng() - 0.5,
      );
      const next = dirs[Math.floor(rng() * Math.min(2, dirs.length))]!;
      q = next.q;
      r = next.r;
    }
  }
  return land;
}

function keepLargestComponent(land: Set<string>): Set<string> {
  const comps = connectedComponents(land);
  if (comps.length === 0) return land;
  comps.sort((a, b) => b.size - a.size);
  return comps[0]!;
}

function connectedComponents(land: Set<string>): Set<string>[] {
  const seen = new Set<string>();
  const comps: Set<string>[] = [];
  for (const start of land) {
    if (seen.has(start)) continue;
    const comp = new Set<string>();
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const key = stack.pop()!;
      comp.add(key);
      const [q, r] = key.split(',').map(Number);
      for (const n of hexNeighbors(q, r)) {
        const nk = cellKey(n.q, n.r);
        if (!land.has(nk) || seen.has(nk)) continue;
        seen.add(nk);
        stack.push(nk);
      }
    }
    comps.push(comp);
  }
  return comps;
}
