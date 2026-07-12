import { cellKey, type GameConfig, type HexCell, type Player } from './types';
import { PLAYER_COLORS, defaultPlayerSetup } from './constants';
import { hexDistance, hexNeighbors } from './hex';

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
} {
  const rng = createRng(config.seed);
  const cells: Record<string, HexCell> = {};
  const radius = config.mapRadius;

  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) {
      // Carve irregular coastline
      const dist = hexDistance({ q, r }, { q: 0, r: 0 });
      const noise = rng();
      if (dist > radius - 1.2 && noise > 0.55) continue;
      if (dist > radius - 0.5 && noise > 0.25) continue;

      cells[cellKey(q, r)] = {
        q,
        r,
        owner: 0,
        unit: null,
        building: null,
        tree: false,
        palm: false,
        training: null,
      };
    }
  }

  // Scatter trees
  for (const cell of Object.values(cells)) {
    if (rng() < 0.08) {
      cell.tree = true;
      if (rng() < 0.35) cell.palm = true;
    }
  }

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
    });
  }

  placeStartingProvinces(cells, players, rng, config);

  return { cells, players };
}

function placeStartingProvinces(
  cells: Record<string, HexCell>,
  players: Player[],
  rng: () => number,
  config: GameConfig,
): void {
  const keys = Object.keys(cells);
  const minSeparation = Math.max(3, Math.floor(config.mapRadius * 0.55));

  const starts: string[] = [];

  for (const player of players) {
    let placed = false;
    for (let attempt = 0; attempt < 200 && !placed; attempt++) {
      const key = keys[Math.floor(rng() * keys.length)];
      const cell = cells[key];
      if (!cell || cell.owner !== 0) continue;

      const { q, r } = cell;
      const tooClose = starts.some((s) => {
        const [sq, sr] = s.split(',').map(Number);
        return hexDistance({ q, r }, { q: sq, r: sr }) < minSeparation;
      });
      if (tooClose) continue;

      // Claim a small blob of 3–5 hexes
      const blob = growBlob(cells, q, r, 3 + Math.floor(rng() * 3), rng);
      if (blob.length < 3) continue;

      for (const bk of blob) {
        const c = cells[bk];
        c.owner = player.id;
        c.tree = false;
        c.palm = false;
      }

      // Capital near center of blob
      const capital = cells[blob[0]];
      capital.building = 'castle';
      starts.push(blob[0]);
      placed = true;
    }

    if (!placed) {
      // Fallback: any free hex
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
