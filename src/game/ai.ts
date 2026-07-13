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
import {
  cellKey,
  type AiDifficulty,
  type HouseRank,
  type PlayerId,
  type SelectionMode,
  type UnitRank,
} from './types';

interface AiProfile {
  mistakeChance: number;
  skipMoveChance: number;
  buildPasses: number;
  reserveMoney: number;
  aggression: number;
  preferEconomy: number;
  maxMoves: number;
  /** Always move if any positive-scoring target exists. */
  alwaysMove: boolean;
  /** Prefer land grab / army over farming. */
  expandFirst: boolean;
  /** Target units ≈ hexes * density. */
  armyDensity: number;
}

const PROFILES: Record<AiDifficulty, AiProfile> = {
  easy: {
    mistakeChance: 0.35,
    skipMoveChance: 0.25,
    buildPasses: 1,
    reserveMoney: 12,
    aggression: 0.45,
    preferEconomy: 0.55,
    maxMoves: 10,
    alwaysMove: false,
    expandFirst: false,
    armyDensity: 0.2,
  },
  normal: {
    mistakeChance: 0.08,
    skipMoveChance: 0.05,
    buildPasses: 2,
    reserveMoney: 6,
    aggression: 0.8,
    preferEconomy: 0.7,
    maxMoves: 18,
    alwaysMove: false,
    expandFirst: true,
    armyDensity: 0.35,
  },
  hard: {
    mistakeChance: 0.01,
    skipMoveChance: 0,
    buildPasses: 3,
    reserveMoney: 3,
    aggression: 1,
    preferEconomy: 0.55,
    maxMoves: 32,
    alwaysMove: true,
    expandFirst: true,
    armyDensity: 0.45,
  },
  expert: {
    mistakeChance: 0,
    skipMoveChance: 0,
    buildPasses: 5,
    reserveMoney: 0,
    aggression: 1.25,
    preferEconomy: 0.35,
    maxMoves: 80,
    alwaysMove: true,
    expandFirst: true,
    armyDensity: 0.65,
  },
};

/** Heuristic AI — batched province rebuilds to avoid UI freezes. */
export function runAiTurn(game: Game, playerId: PlayerId): void {
  if (game.winnerId || game.currentPlayerId !== playerId) return;
  if (game.currentPlayer().isHuman) return;

  const difficulty = game.config.aiDifficulty ?? 'normal';
  const profile = PROFILES[difficulty] ?? PROFILES.normal;
  const provinces = provincesOfPlayer(game.provinces, playerId);
  if (provinces.length === 0) return;

  game.beginBatch();
  try {
    // Expert: house/recruit pressure first, farms last
    for (let pass = 0; pass < profile.buildPasses; pass++) {
      for (const prov of [...provincesOfPlayer(game.provinces, playerId)].sort(
        (a, b) => b.hexes.length - a.hexes.length,
      )) {
        maybeBuild(game, prov.id, profile, difficulty, pass);
      }
    }

    // Summon mid-turn so money after builds still recruits when possible
    for (const prov of provincesOfPlayer(game.provinces, playerId)) {
      maybeSummon(game, prov.id, profile, difficulty);
    }

    // Extra farm pass for leftover cash after recruiting (non-blocking)
    if (profile.expandFirst) {
      for (const prov of provincesOfPlayer(game.provinces, playerId)) {
        maybeBuildFarmOnly(game, prov.id, profile);
      }
    }

    moveAllUnits(game, playerId, profile);
    game.clearSelection();
  } finally {
    game.endBatch();
  }
}

function moveAllUnits(game: Game, playerId: PlayerId, profile: AiProfile): void {
  const unitKeys: string[] = [];
  for (const prov of provincesOfPlayer(game.provinces, playerId)) {
    for (const key of prov.hexes) {
      const u = game.cells[key].unit;
      if (u && u.owner === playerId && !u.moved) unitKeys.push(key);
    }
  }

  unitKeys.sort((a, b) => {
    const ua = game.cells[a].unit!;
    const ub = game.cells[b].unit!;
    const rankDiff = ub.rank - ua.rank;
    if (rankDiff !== 0) return rankDiff;
    return (ub.count ?? 1) - (ua.count ?? 1);
  });

  let moved = 0;
  for (const fromKey of unitKeys) {
    if (moved >= profile.maxMoves) break;
    const unit = game.cells[fromKey]?.unit;
    if (!unit || unit.moved || unit.owner !== playerId) continue;
    if (Math.random() < profile.skipMoveChance) continue;

    const targets = [...game.moveTargets(fromKey)];
    if (targets.length === 0) continue;

    let best = targets[0]!;
    let bestScore = scoreMove(game, playerId, fromKey, best, profile);
    for (let i = 1; i < targets.length; i++) {
      const s = scoreMove(game, playerId, fromKey, targets[i]!, profile);
      if (s > bestScore) {
        bestScore = s;
        best = targets[i]!;
      }
    }

    let chosen = best;
    if (Math.random() < profile.mistakeChance && targets.length > 1) {
      const top = [...targets]
        .map((t) => ({ t, s: scoreMove(game, playerId, fromKey, t, profile) }))
        .sort((a, b) => b.s - a.s)
        .slice(0, Math.min(3, targets.length));
      chosen = top[Math.floor(Math.random() * top.length)]!.t;
    }

    const shouldMove =
      profile.alwaysMove
        ? bestScore > 0
        : bestScore >= 8 || Math.random() < profile.aggression;

    if (shouldMove) {
      game.moveUnitTo(fromKey, chosen);
      moved += 1;
    }
  }
}

function scoreMove(
  game: Game,
  playerId: PlayerId,
  fromKey: string,
  toKey: string,
  profile: AiProfile,
): number {
  const from = game.cells[fromKey];
  const cell = game.cells[toKey];
  const unit = from?.unit;
  if (!cell || !unit) return -10;

  let s = 0;
  const myProv = game.getProvince(fromKey);
  const small = !!myProv && myProv.hexes.length <= 5;

  if (cell.owner !== 0 && cell.owner !== playerId) {
    s += 55 * profile.aggression;
    if (cell.building === 'castle') s += 90;
    else if (isHouseBuilding(cell.building)) s += 55;
    else if (cell.building === 'farm') s += 36;
    else if (cell.building === 'tower' || cell.building === 'strongTower') s += 22;
    if (cell.unit) {
      s += 14 + cell.unit.rank * 7;
      if (unit.rank > cell.unit.rank) s += 28;
      else if (unit.rank === cell.unit.rank && (unit.count ?? 1) > (cell.unit.count ?? 1)) {
        s += 16;
      }
    } else {
      s += 10; // empty enemy land is free expansion
    }
    if (small) s += 25;
    if (profile.expandFirst) s += 12;
    return s;
  }

  if (cell.owner === 0) {
    s += 22 + profile.aggression * 14;
    let touchesEnemy = false;
    let touchesMine = false;
    let enemyWeak = false;
    for (const n of hexNeighbors(cell.q, cell.r)) {
      const nc = game.cells[cellKey(n.q, n.r)];
      if (!nc) continue;
      if (nc.owner !== 0 && nc.owner !== playerId) {
        touchesEnemy = true;
        if (!nc.unit || (nc.unit.rank ?? 0) < unit.rank) enemyWeak = true;
      }
      if (nc.owner === playerId) touchesMine = true;
    }
    if (touchesEnemy) s += 18 * profile.aggression;
    if (enemyWeak) s += 10;
    if (touchesMine) s += 6;
    if (cell.tree) s += 2 * profile.preferEconomy;
    if (small) s += 20;
    if (profile.expandFirst) s += 10;
    return s;
  }

  // Own territory
  if (cell.unit && cell.unit.rank === unit.rank) {
    const total = (unit.count ?? 1) + (cell.unit.count ?? 1);
    s += 8 + Math.min(14, total * 2);
    // Expert merges toward the front
    if (profile.expandFirst) {
      for (const n of hexNeighbors(cell.q, cell.r)) {
        const nc = game.cells[cellKey(n.q, n.r)];
        if (nc && nc.owner !== 0 && nc.owner !== playerId) {
          s += 12;
          break;
        }
      }
    }
  } else if (cell.tree) {
    s += 3 * profile.preferEconomy;
  } else {
    s += 1;
  }

  for (const n of hexNeighbors(cell.q, cell.r)) {
    const nc = game.cells[cellKey(n.q, n.r)];
    if (nc && nc.owner !== 0 && nc.owner !== playerId) {
      s += 12 * profile.aggression;
      break;
    }
    if (nc && nc.owner === 0) {
      s += 3 * profile.aggression;
    }
  }

  return s;
}

function maybeSummon(
  game: Game,
  provinceId: number,
  profile: AiProfile,
  difficulty: AiDifficulty,
): void {
  const prov = game.provinces.find((p) => p.id === provinceId);
  if (!prov || prov.owner !== game.currentPlayerId) return;

  const houseKeys = prov.hexes.filter((h) => isHouseBuilding(game.cells[h].building));
  if (houseKeys.length === 0) return;

  const ordered =
    difficulty === 'easy'
      ? houseKeys
      : [...houseKeys].sort((a, b) => {
          const ra = houseRankFromKind(game.cells[a].building!) ?? 0;
          const rb = houseRankFromKind(game.cells[b].building!) ?? 0;
          return rb - ra;
        });

  const units = prov.hexes.filter((h) => game.cells[h].unit).length;
  const training = prov.hexes.filter((h) => game.cells[h].training).length;
  const threatened = isThreatened(game, prov.hexes, prov.owner);
  const net = netIncome(game.cells, prov);
  const armyCap = Math.max(1, Math.ceil(prov.hexes.length * profile.armyDensity));

  for (const key of ordered) {
    const cell = game.cells[key];
    if (!isHouseBuilding(cell.building) || cell.training) continue;
    const rank = houseRankFromKind(cell.building!) as UnitRank;
    const live = game.provinces.find((x) => x.id === provinceId);
    if (!live) continue;

    const cost = UNIT_COST[rank];
    const reserve =
      units + training === 0 ? 0 : profile.reserveMoney;
    if (live.money < cost + reserve) continue;

    if (difficulty === 'easy' && rank >= 3 && net < 6) continue;
    // Expert: avoid starving income with too many high-rank upkeeps unless rich
    if (difficulty === 'expert' && rank >= 3 && net < rank * 3 && units + training >= 2) {
      continue;
    }

    const forceRecruit =
      difficulty === 'expert' &&
      (units + training === 0 || threatened || live.money >= cost * 2);

    const want =
      forceRecruit ||
      units + training === 0 ||
      threatened ||
      units + training < armyCap ||
      live.money > cost + 16 + profile.reserveMoney;

    if (!want) continue;
    if (Math.random() < profile.mistakeChance * 0.4) continue;

    game.summonAt(key);
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

function enemyUnitAdjacent(game: Game, hexes: string[], owner: PlayerId): boolean {
  for (const key of hexes) {
    const c = game.cells[key];
    for (const n of hexNeighbors(c.q, c.r)) {
      const nc = game.cells[cellKey(n.q, n.r)];
      if (nc && nc.owner !== 0 && nc.owner !== owner && nc.unit) return true;
    }
  }
  return false;
}

function pickBuildHex(
  game: Game,
  candidates: string[],
  preferBorder: boolean,
): string {
  if (candidates.length === 1) return candidates[0]!;
  const border: string[] = [];
  const inner: string[] = [];
  for (const h of candidates) {
    const c = game.cells[h];
    const onEdge = hexNeighbors(c.q, c.r).some((n) => {
      const nc = game.cells[cellKey(n.q, n.r)];
      return !nc || nc.owner !== c.owner;
    });
    (onEdge ? border : inner).push(h);
  }
  const pool = preferBorder
    ? border.length
      ? border
      : candidates
    : inner.length
      ? inner
      : candidates;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

function maybeBuild(
  game: Game,
  provinceId: number,
  profile: AiProfile,
  difficulty: AiDifficulty,
  pass: number,
): void {
  const prov = game.provinces.find((p) => p.id === provinceId);
  if (!prov || prov.owner !== game.currentPlayerId) return;

  const buildable = prov.hexes.filter((h) => {
    const c = game.cells[h];
    return !c.unit && !c.building;
  });
  if (buildable.length === 0) return;

  const houses = prov.hexes.filter((h) => isHouseBuilding(game.cells[h].building));
  const farms = prov.hexes.filter((h) => game.cells[h].building === 'farm').length;
  const net = netIncome(game.cells, prov);
  const threatened = isThreatened(game, prov.hexes, prov.owner);
  const hotFront = enemyUnitAdjacent(game, prov.hexes, prov.owner);
  const freeSlots = buildable.length;
  const units = prov.hexes.filter((h) => game.cells[h].unit).length;
  const training = prov.hexes.filter((h) => game.cells[h].training).length;

  // --- No recruitment house yet ---
  if (houses.length === 0) {
    const houseNeed = HOUSE_COST[1] + Math.floor(profile.reserveMoney * 0.1);
    if (prov.money >= houseNeed) {
      place(game, pickBuildHex(game, buildable, false), 'buildHouse1');
      return;
    }
    const scarceLand = freeSlots <= 2 || prov.hexes.length <= 4;
    if (scarceLand || profile.expandFirst) return;
    if (freeSlots > 1 && net < 5) {
      const cost = farmCost(game.cells, prov);
      if (prov.money >= cost) place(game, pickBuildHex(game, buildable, false), 'buildFarm');
    }
    return;
  }

  // Early expert/hard: keep cash for militia instead of farms while under-armed
  const underArmed = units + training < Math.max(1, Math.ceil(prov.hexes.length * profile.armyDensity));
  if (profile.expandFirst && underArmed && pass < profile.buildPasses - 1) {
    // Still allow house upgrades / defense below
  } else if (!profile.expandFirst) {
    // fall through
  }

  // Upgrade houses
  for (const rank of [4, 3, 2] as HouseRank[]) {
    const has = houses.some((h) => houseRankFromKind(game.cells[h].building!) === rank);
    const needFarms = Math.max(0, rank - 2);
    if (
      !has &&
      farms >= needFarms &&
      net >= rank * 2 &&
      prov.money >= HOUSE_COST[rank] + profile.reserveMoney &&
      (!profile.expandFirst || !underArmed || rank === 2)
    ) {
      place(game, pickBuildHex(game, buildable, false), `buildHouse${rank}` as SelectionMode);
      return;
    }
  }

  // Extra house when large
  if (
    houses.length < Math.min(3, 1 + Math.floor(prov.hexes.length / 5)) &&
    freeSlots > 1 &&
    prov.money >= HOUSE_COST[1] + 12 + profile.reserveMoney &&
    net >= 5 &&
    !underArmed
  ) {
    place(game, pickBuildHex(game, buildable, false), 'buildHouse1');
    return;
  }

  // Defense — expert builds when enemy units are adjacent
  const wantTower =
    (hotFront && profile.aggression >= 1) ||
    (threatened && Math.random() < 0.35 + profile.aggression * 0.4);
  if (wantTower && prov.money >= TOWER_COST + profile.reserveMoney * 0.2) {
    const mode: SelectionMode =
      prov.money >= STRONG_TOWER_COST + profile.reserveMoney && (hotFront || profile.aggression > 1)
        ? 'buildStrongTower'
        : 'buildTower';
    place(game, pickBuildHex(game, buildable, true), mode);
    return;
  }

  // Farms: delayed for expand-first AIs (handled in maybeBuildFarmOnly after summon)
  if (!profile.expandFirst) {
    maybeBuildFarmOnly(game, provinceId, profile);
  } else if (difficulty !== 'expert' && pass === profile.buildPasses - 1) {
    maybeBuildFarmOnly(game, provinceId, profile);
  }
}

function maybeBuildFarmOnly(game: Game, provinceId: number, profile: AiProfile): void {
  const prov = game.provinces.find((p) => p.id === provinceId);
  if (!prov || prov.owner !== game.currentPlayerId) return;

  const buildable = prov.hexes.filter((h) => {
    const c = game.cells[h];
    return !c.unit && !c.building;
  });
  if (buildable.length === 0) return;

  const houses = prov.hexes.filter((h) => isHouseBuilding(game.cells[h].building));
  if (houses.length === 0) return;

  const farms = prov.hexes.filter((h) => game.cells[h].building === 'farm').length;
  const net = netIncome(game.cells, prov);
  const freeSlots = buildable.length;
  const units = prov.hexes.filter((h) => game.cells[h].unit).length;
  const idleHouse = houses.some((h) => !game.cells[h].training);

  // Keep recruiting if under-armed
  if (profile.expandFirst && idleHouse && units === 0 && prov.money >= UNIT_COST[1]) return;
  if (
    profile.expandFirst &&
    idleHouse &&
    units < Math.ceil(prov.hexes.length * profile.armyDensity) &&
    prov.money >= UNIT_COST[1] + farmCost(game.cells, prov)
  ) {
    return;
  }

  const farmTarget = profile.expandFirst
    ? Math.max(0, Math.floor(prov.hexes.length / 4))
    : Math.max(1, Math.floor(prov.hexes.length / 3));
  const wantFarm = farms < farmTarget || net < 3 + profile.preferEconomy * 3;
  if (!wantFarm || (freeSlots <= 1 && net >= 2)) return;

  const cost = farmCost(game.cells, prov);
  if (prov.money >= cost + Math.floor(profile.reserveMoney * 0.2)) {
    place(game, pickBuildHex(game, buildable, false), 'buildFarm');
  }
}

function place(game: Game, hexKey: string, mode: SelectionMode): void {
  game.buildAt(hexKey, mode);
}
