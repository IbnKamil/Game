import { cellKey, type GameConfig, type HexCell, type Player } from './types';
import {
  DEFAULT_FOREST_DENSITY,
  PLAYER_COLORS,
  clampForestDensity,
  defaultPlayerSetup,
} from './constants';
import { hexDistance, hexNeighbors } from './hex';
import { buildLandMask, resolveMapShape, type ConcreteMapShape } from './mapShapes';
import { hexElevation } from './topo';

export type { ConcreteMapShape } from './mapShapes';
export { MAP_SHAPE_PRESETS, resolveMapShape } from './mapShapes';

/** Simple seeded PRNG (mulberry32). */
export function createRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateMap(config: GameConfig): {
  cells: Record<string, HexCell>;
  players: Player[];
  mapShape: ConcreteMapShape;
} {
  const rng = createRng(config.seed);
  const shape = resolveMapShape(config.mapShape, rng);
  const radius = config.mapRadius;
  const mask = buildLandMask(shape, radius, config.seed, rng);

  const cells: Record<string, HexCell> = {};
  for (const key of mask) {
    const [q, r] = key.split(',').map(Number);
    cells[key] = {
      q,
      r,
      owner: 0,
      unit: null,
      building: null,
      tree: false,
      palm: false,
      training: null,
      elevation: hexElevation(q, r, config.seed),
    };
  }

  scatterTrees(cells, rng, config.forestDensity ?? DEFAULT_FOREST_DENSITY);

  const players: Player[] = [];
  for (let i = 1; i <= config.playerCount; i++) {
    const setup =
      config.players[i - 1] ??
      defaultPlayerSetup(i - 1, config.humanPlayerId === i);
    players.push({
      id: i,
      name: setup.name || `Государство ${i}`,
      color: setup.color || PLAYER_COLORS[(i - 1) % PLAYER_COLORS.length],
      isHuman: setup.isHuman,
      alive: true,
      teamId: setup.teamId || i,
      ...(setup.isHuman
        ? {}
        : { aiDifficulty: setup.aiDifficulty ?? config.aiDifficulty }),
    });
  }

  placeStartingProvinces(cells, players, rng, config, shape);

  return { cells, players, mapShape: shape };
}

/** Place trees so that ~forestDensity% of hexes are forested (mid elevations preferred). */
export function scatterTrees(
  cells: Record<string, HexCell>,
  rng: () => number,
  forestDensity: number,
): void {
  const density = clampForestDensity(forestDensity);
  const keys = Object.keys(cells);
  if (keys.length === 0 || density <= 0) return;

  const target = Math.round((keys.length * density) / 100);
  if (target <= 0) return;

  const scored = keys.map((k) => {
    const e = cells[k].elevation;
    const mid = e > 0.25 && e < 0.75 ? 1.5 : 1;
    return { k, score: rng() * mid };
  });
  scored.sort((a, b) => b.score - a.score);

  const n = Math.min(target, scored.length);
  for (let i = 0; i < n; i++) {
    const cell = cells[scored[i]!.k]!;
    cell.tree = true;
    if (rng() < 0.35) cell.palm = true;
  }
}

function placeStartingProvinces(
  cells: Record<string, HexCell>,
  players: Player[],
  rng: () => number,
  config: GameConfig,
  shape: ConcreteMapShape,
): void {
  const keys = Object.keys(cells);
  const land = keys.length;
  // Separation scales with land area so odd shapes still space players out
  let minSeparation = Math.max(3, Math.floor(Math.sqrt(land / Math.max(2, players.length)) * 0.85));
  if (shape === 'corridor') minSeparation = Math.max(3, Math.floor(config.mapRadius * 0.45));
  if (shape === 'islands' || shape === 'twin') {
    minSeparation = Math.max(4, Math.floor(config.mapRadius * 0.4));
  }

  const starts: string[] = [];
  const components = landComponents(cells);

  for (let pi = 0; pi < players.length; pi++) {
    const player = players[pi]!;
    let placed = false;

    // Prefer spreading across islands / twin continents
    const preferredKeys =
      (shape === 'islands' || shape === 'twin') && components.length > 1
        ? [...(components[pi % components.length] ?? keys)]
        : keys;

    for (let attempt = 0; attempt < 220 && !placed; attempt++) {
      const pool = attempt < 160 ? preferredKeys : keys;
      const key = pool[Math.floor(rng() * pool.length)];
      if (!key) continue;
      const cell = cells[key];
      if (!cell || cell.owner !== 0) continue;

      const { q, r } = cell;
      const tooClose = starts.some((s) => {
        const [sq, sr] = s.split(',').map(Number);
        return hexDistance({ q, r }, { q: sq, r: sr }) < minSeparation;
      });
      if (tooClose) continue;

      const blob = growBlob(cells, q, r, 3 + Math.floor(rng() * 3), rng);
      if (blob.length < 3) continue;

      for (const bk of blob) {
        const c = cells[bk];
        c.owner = player.id;
        c.tree = false;
        c.palm = false;
      }

      const capital = cells[blob[0]];
      capital.building = 'castle';
      starts.push(blob[0]);
      placed = true;
    }

    if (!placed) {
      // Relax separation
      for (let attempt = 0; attempt < 80 && !placed; attempt++) {
        const key = keys[Math.floor(rng() * keys.length)];
        const cell = cells[key];
        if (!cell || cell.owner !== 0) continue;
        const blob = growBlob(cells, cell.q, cell.r, 3, rng);
        if (blob.length < 2) continue;
        for (const bk of blob) {
          cells[bk].owner = player.id;
          cells[bk].tree = false;
          cells[bk].palm = false;
        }
        cells[blob[0]].building = 'castle';
        starts.push(blob[0]);
        placed = true;
      }
    }

    if (!placed) {
      const free = keys.find((k) => cells[k].owner === 0);
      if (free) {
        const c = cells[free];
        c.owner = player.id;
        c.building = 'castle';
        c.tree = false;
        starts.push(free);
      }
    }
  }
}

function landComponents(cells: Record<string, HexCell>): string[][] {
  const seen = new Set<string>();
  const comps: string[][] = [];
  for (const start of Object.keys(cells)) {
    if (seen.has(start)) continue;
    const comp: string[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const key = stack.pop()!;
      comp.push(key);
      const cell = cells[key];
      for (const n of hexNeighbors(cell.q, cell.r)) {
        const nk = cellKey(n.q, n.r);
        if (!cells[nk] || seen.has(nk)) continue;
        seen.add(nk);
        stack.push(nk);
      }
    }
    comps.push(comp);
  }
  comps.sort((a, b) => b.length - a.length);
  return comps;
}

function growBlob(
  cells: Record<string, HexCell>,
  q: number,
  r: number,
  size: number,
  rng: () => number,
): string[] {
  const result: string[] = [];
  const start = cellKey(q, r);
  if (!cells[start] || cells[start].owner !== 0) return result;

  const frontier = [start];
  const seen = new Set<string>([start]);

  while (result.length < size && frontier.length > 0) {
    const idx = Math.floor(rng() * frontier.length);
    const key = frontier.splice(idx, 1)[0];
    result.push(key);
    const cell = cells[key];
    for (const n of hexNeighbors(cell.q, cell.r)) {
      const nk = cellKey(n.q, n.r);
      if (!cells[nk] || seen.has(nk) || cells[nk].owner !== 0) continue;
      seen.add(nk);
      frontier.push(nk);
    }
  }
  return result;
}

export function isLand(cells: Record<string, HexCell>, q: number, r: number): boolean {
  return cellKey(q, r) in cells;
}
