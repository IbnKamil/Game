import {
  HOUSE_COST,
  STRONG_TOWER_COST,
  TOWER_COST,
  UNIT_COST,
  houseRankFromKind,
  isHouseBuilding,
} from './constants';
import { farmCost, netIncome, provincesOfPlayer } from './economy';
import type { Game } from './Game';
import { hexNeighbors } from './hex';
import { cellKey, type AiDifficulty, type HouseRank, type PlayerId, type UnitRank } from './types';

interface AiProfile {
  mistakeChance: number;
  skipMoveChance: number;
  buildPasses: number;
  reserveMoney: number;
  aggression: number;
  preferEconomy: number;
}

const PROFILES: Record<AiDifficulty, AiProfile> = {
  easy: {
    mistakeChance: 0.45,
    skipMoveChance: 0.35,
    buildPasses: 1,
    reserveMoney: 18,
    aggression: 0.35,
    preferEconomy: 0.4,
  },
  normal: {
    mistakeChance: 0.18,
    skipMoveChance: 0.12,
    buildPasses: 1,
    reserveMoney: 10,
    aggression: 0.65,
    preferEconomy: 0.7,
  },
  hard: {
    mistakeChance: 0.05,
    skipMoveChance: 0.03,
    buildPasses: 2,
    reserveMoney: 6,
    aggression: 0.9,
    preferEconomy: 0.95,
  },
  expert: {
    mistakeChance: 0,
    skipMoveChance: 0,
    buildPasses: 3,
    reserveMoney: 4,
    aggression: 1,
    preferEconomy: 1,
  },
};

/** Heuristic AI scaled by difficulty. */
export function runAiTurn(game: Game, playerId: PlayerId): void {
  const difficulty = game.config.aiDifficulty ?? 'normal';
  const profile = PROFILES[difficulty];
  const provinces = provincesOfPlayer(game.provinces, playerId);
  if (provinces.length === 0) return;

  for (let pass = 0; pass < profile.buildPasses; pass++) {
    for (const prov of [...provincesOfPlayer(game.provinces, playerId)].sort(
      (a, b) => b.hexes.length - a.hexes.length,
    )) {
      maybeBuild(game, prov.id, profile);
    }
  }

  const fresh = provincesOfPlayer(game.provinces, playerId);
  for (const prov of fresh) {
    maybeSummon(game, prov.id, profile, difficulty);
  }

  const unitKeys: string[] = [];
  for (const prov of provincesOfPlayer(game.provinces, playerId)) {
    for (const key of prov.hexes) {
      if (game.cells[key].unit && !game.cells[key].unit!.moved) unitKeys.push(key);
    }
  }

  // Expert/hard: move highest rank first
  if (difficulty === 'hard' || difficulty === 'expert') {
    unitKeys.sort((a, b) => (game.cells[b].unit?.rank ?? 0) - (game.cells[a].unit?.rank ?? 0));
  }

  for (const fromKey of unitKeys) {
    if (Math.random() < profile.skipMoveChance) continue;

    const targets = [...game.moveTargets(fromKey)];
    if (targets.length === 0) continue;

    targets.sort(
      (a, b) =>
        scoreMove(game, playerId, a, profile) - scoreMove(game, playerId, b, profile),
    );

    let chosen = targets[targets.length - 1];
    if (Math.random() < profile.mistakeChance && targets.length > 1) {
      chosen = targets[Math.floor(Math.random() * Math.min(3, targets.length))];
    }

    const bestScore = scoreMove(game, playerId, chosen, profile);
    if (bestScore > 0 || Math.random() < profile.aggression) {
      game.ui = { selectedKey: fromKey, mode: 'unit', hoverKey: null };
      game.selectHex(chosen);
    }
  }

  game.clearSelection();
}

function scoreMove(
  game: Game,
  playerId: PlayerId,
  toKey: string,
  profile: AiProfile,
): number {
  const cell = game.cells[toKey];
  if (!cell) return -10;
  if (cell.owner !== 0 && cell.owner !== playerId) {
    let s = 30 * profile.aggression;
    if (cell.building === 'farm') s += 25;
    if (cell.building === 'castle') s += 55;
    if (cell.unit) s += 8 + cell.unit.rank * 4;
    if (isHouseBuilding(cell.building)) s += 15;
    return s;
  }
  if (cell.owner === 0) return 12 + profile.aggression * 6;
  if (cell.tree) return 7 * profile.preferEconomy;
  if (cell.unit) return 4; // merge
  return 1;
}

function maybeSummon(
  game: Game,
  provinceId: number,
  profile: AiProfile,
  difficulty: AiDifficulty,
): void {
  const prov = game.provinces.find((p) => p.id === provinceId);
  if (!prov) return;

  const houseKeys = prov.hexes.filter((h) => isHouseBuilding(game.cells[h].building));
  // Prefer higher houses on harder difficulties
  const ordered =
    difficulty === 'easy'
      ? houseKeys
      : [...houseKeys].sort((a, b) => {
          const ra = houseRankFromKind(game.cells[a].building!) ?? 0;
          const rb = houseRankFromKind(game.cells[b].building!) ?? 0;
          return rb - ra;
        });

  for (const key of ordered) {
    const cell = game.cells[key];
    if (!isHouseBuilding(cell.building) || cell.training) continue;
    const rank = houseRankFromKind(cell.building!) as UnitRank;
    const live = game.provinces.find((x) => x.id === provinceId);
    if (!live || live.money < UNIT_COST[rank] + profile.reserveMoney) continue;

    const units = prov.hexes.filter((h) => game.cells[h].unit).length;
    const threatened = isThreatened(game, prov.hexes, prov.owner);
    const want =
      threatened ||
      units < Math.max(1, Math.floor(prov.hexes.length / (difficulty === 'easy' ? 6 : 4))) ||
      live.money > 35 + profile.reserveMoney;

    if (want && Math.random() > profile.mistakeChance * 0.5) {
      game.ui = { selectedKey: key, mode: 'house', hoverKey: null };
      game.summonFromHouse();
    }
  }
}

function isThreatened(game: Game, hexes: string[], owner: PlayerId): boolean {
  for (const key of hexes) {
    const c = game.cells[key];
    for (const n of hexNeighbors(c.q, c.r)) {
      const nc = game.cells[cellKey(n.q, n.r)];
      if (nc && nc.owner !== 0 && nc.owner !== owner) return true;
    }
  }
  return false;
}

function maybeBuild(game: Game, provinceId: number, profile: AiProfile): void {
  const prov = game.provinces.find((p) => p.id === provinceId);
  if (!prov) return;

  const empty = prov.hexes.filter((h) => {
    const c = game.cells[h];
    return !c.unit && !c.tree && !c.building;
  });
  if (empty.length === 0) return;

  const houses = prov.hexes.filter((h) => isHouseBuilding(game.cells[h].building));
  const farms = prov.hexes.filter((h) => game.cells[h].building === 'farm').length;
  const net = netIncome(game.cells, prov);
  const threatened = isThreatened(game, prov.hexes, prov.owner);

  // Prefer border hex for towers, inner for farms on harder AI
  let pick = empty[Math.floor(Math.random() * empty.length)];
  if (profile.aggression > 0.7) {
    const border = empty.filter((h) => {
      const c = game.cells[h];
      return hexNeighbors(c.q, c.r).some((n) => {
        const nc = game.cells[cellKey(n.q, n.r)];
        return !nc || nc.owner !== prov.owner;
      });
    });
    const inner = empty.filter((h) => !border.includes(h));
    if (threatened && border.length) pick = border[0];
    else if (inner.length) pick = inner[Math.floor(Math.random() * inner.length)];
  }

  if (houses.length === 0 && prov.money >= HOUSE_COST[1] + profile.reserveMoney * 0.3) {
    place(game, prov.id, pick, 'buildHouse1');
    return;
  }

  for (const rank of [4, 3, 2] as HouseRank[]) {
    const has = houses.some((h) => houseRankFromKind(game.cells[h].building!) === rank);
    const needFarms = profile.preferEconomy > 0.8 ? rank - 1 : rank;
    if (!has && prov.money >= HOUSE_COST[rank] + profile.reserveMoney && farms >= needFarms) {
      place(game, prov.id, pick, `buildHouse${rank}` as const);
      return;
    }
  }

  if (threatened && prov.money >= TOWER_COST + profile.reserveMoney * 0.2) {
    if (Math.random() < 0.35 + profile.aggression * 0.4) {
      const mode =
        prov.money >= STRONG_TOWER_COST + profile.reserveMoney && profile.aggression > 0.7
          ? 'buildStrongTower'
          : 'buildTower';
      place(game, prov.id, pick, mode);
      return;
    }
  }

  if (net < 8 * profile.preferEconomy || farms < prov.hexes.length / 3) {
    const cost = farmCost(game.cells, prov);
    if (prov.money >= cost + profile.reserveMoney * 0.2) {
      place(game, prov.id, pick, 'buildFarm');
      return;
    }
  }

  if (prov.money >= HOUSE_COST[1] + 20 + profile.reserveMoney && houses.length < 2 + Math.floor(profile.aggression)) {
    place(game, prov.id, pick, 'buildHouse1');
  }
}

function place(
  game: Game,
  provinceId: number,
  hexKey: string,
  mode:
    | 'buildFarm'
    | 'buildTower'
    | 'buildStrongTower'
    | 'buildHouse1'
    | 'buildHouse2'
    | 'buildHouse3'
    | 'buildHouse4',
): void {
  const prov = game.provinces.find((p) => p.id === provinceId);
  if (!prov) return;
  game.ui = { selectedKey: prov.hexes[0], mode: 'none', hoverKey: null };
  game.setBuildMode(mode);
  game.selectHex(hexKey);
}
