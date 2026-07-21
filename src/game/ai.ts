import {
  BUILDING_PROTECTION,
  HOUSE_COST,
  STRONG_TOWER_COST,
  TOWER_COST,
  UNIT_COST,
  UNIT_UPKEEP,
  houseRankFromKind,
  isHouseBuilding,
} from './constants';
import { farmCost, netIncome, provincesOfPlayer } from './economy';
import type { Game } from './Game';
import { hexNeighbors } from './hex';
import {
  cellKey,
  type AiDifficulty,
  type BuildingKind,
  type HouseRank,
  type PlayerId,
  type Province,
  type SelectionMode,
  type UnitRank,
} from './types';

function aiNet(game: Game, prov: Province): number {
  return netIncome(game.cells, prov, game.farmBonusFor(prov.owner));
}

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
    aggression: 0.85,
    preferEconomy: 0.7,
    maxMoves: 20,
    alwaysMove: false,
    expandFirst: true,
    armyDensity: 0.4,
  },
  hard: {
    mistakeChance: 0.01,
    skipMoveChance: 0,
    buildPasses: 4,
    reserveMoney: 2,
    aggression: 1.1,
    preferEconomy: 0.6,
    maxMoves: 40,
    alwaysMove: true,
    expandFirst: true,
    armyDensity: 0.5,
  },
  expert: {
    mistakeChance: 0,
    skipMoveChance: 0,
    buildPasses: 6,
    reserveMoney: 0,
    aggression: 1.35,
    preferEconomy: 0.7,
    maxMoves: 100,
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
    // Opening / economy / defense builds
    for (let pass = 0; pass < profile.buildPasses; pass++) {
      for (const prov of [...provincesOfPlayer(game.provinces, playerId)].sort(
        (a, b) => b.hexes.length - a.hexes.length,
      )) {
        maybeBuild(game, prov.id, profile, difficulty, pass);
      }
    }

    // Recruit every turn when possible (expansion pressure)
    for (const prov of provincesOfPlayer(game.provinces, playerId)) {
      maybeSummon(game, prov.id, profile, difficulty);
    }

    // Extra farm pass for leftover cash after recruiting
    for (const prov of provincesOfPlayer(game.provinces, playerId)) {
      maybeBuildFarmOnly(game, prov.id, profile);
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
    // Allied land: treat as friendly repositioning (never attack)
    if (game.isAlly(playerId, cell.owner)) {
      s += 3;
      for (const n of hexNeighbors(cell.q, cell.r)) {
        const nc = game.cells[cellKey(n.q, n.r)];
        if (nc && nc.owner !== 0 && nc.owner !== playerId && !game.isAlly(playerId, nc.owner)) {
          s += 10 * profile.aggression;
          break;
        }
      }
      return s;
    }
    const myHexes = myProv?.hexes ?? [];
    const bottled = isContained(game, myHexes, playerId);
    s += 55 * profile.aggression;
    // Prefer cuts that destroy / approach enemy economy & barracks
    s += enemyAssetValue(cell.building, bottled) * profile.aggression;
    s += approachEnemyAssetsBonus(game, playerId, toKey) * profile.aggression;
    // Breakout: punching the seal / path to neutrals behind the wall
    if (bottled) {
      s += 35 * profile.aggression;
      s += breakoutTowardNeutralBonus(game, playerId, toKey) * profile.aggression;
    }
    if (cell.unit) {
      s += 14 + cell.unit.rank * 7;
      if (unit.rank > cell.unit.rank) s += 28;
      else if (unit.rank === cell.unit.rank && (unit.count ?? 1) > (cell.unit.count ?? 1)) {
        s += 16;
      }
    } else {
      s += 10;
    }
    if (small) s += 25;
    if (profile.expandFirst) s += 12;
    return s;
  }

  if (cell.owner === 0) {
    s += 28 + profile.aggression * 16;
    let touchesEnemy = false;
    let touchesMine = false;
    let enemyWeak = false;
    for (const n of hexNeighbors(cell.q, cell.r)) {
      const nc = game.cells[cellKey(n.q, n.r)];
      if (!nc) continue;
      if (nc.owner !== 0 && nc.owner !== playerId) {
        if (game.isAlly(playerId, nc.owner)) continue;
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
    if (profile.expandFirst) s += 14;
    s += approachEnemyAssetsBonus(game, playerId, toKey) * 0.85 * profile.aggression;
    // Prefer neutrals that keep a wide frontier (harder to bottle)
    s += neutralFrontierValue(game, toKey) * profile.aggression;
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
          if (!game.isAlly(playerId, nc.owner)) {
            s += 12;
            break;
          }
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
      if (!game.isAlly(playerId, nc.owner)) {
        s += 12 * profile.aggression;
        break;
      }
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

  const units = countOwnedUnits(game, prov.hexes, prov.owner);
  const training = prov.hexes.filter((h) => game.cells[h].training).length;
  const threatened = isThreatened(game, prov.hexes, prov.owner);
  const expanding = hasNeutralAdjacent(game, prov.hexes, prov.owner);
  const bottled = isContained(game, prov.hexes, prov.owner);
  const wallDef = enemyBorderDefense(game, prov.hexes, prov.owner);
  const needBreak = bottled || wallDef >= 2 ? breakRankNeeded(wallDef) : 0;
  const net = aiNet(game, prov);
  const armyCap = Math.max(
    1,
    Math.ceil(
      prov.hexes.length *
        (expanding || bottled
          ? Math.max(profile.armyDensity, bottled ? 0.7 : 0.55)
          : profile.armyDensity),
    ),
  );
  const enemyMax = maxEnemyUnitRank(game, prov.owner);
  const maxHouse = Math.max(
    0,
    ...houseKeys.map((h) => houseRankFromKind(game.cells[h].building!) ?? 0),
  );

  for (const key of ordered) {
    const cell = game.cells[key];
    if (!isHouseBuilding(cell.building) || cell.training) continue;
    const rank = houseRankFromKind(cell.building!) as UnitRank;
    const live = game.provinces.find((x) => x.id === provinceId);
    if (!live) continue;

    const cost = UNIT_COST[rank];
    const reserve =
      expanding || bottled || units + training === 0 ? 0 : profile.reserveMoney;
    if (live.money < cost + reserve) continue;

    if (difficulty === 'easy' && rank >= 3 && net < 4) continue;

    // When sealed behind towers: save for breakers, skip cheap militia spam if HQ exists
    if (needBreak >= 3 && maxHouse >= needBreak && rank < needBreak && live.money < cost + UNIT_COST[needBreak as UnitRank]) {
      continue;
    }

    const needCounter = enemyMax >= rank || (needBreak > 0 && rank >= needBreak);
    if (
      !needCounter &&
      !expanding &&
      !bottled &&
      rank >= 3 &&
      net < UNIT_UPKEEP[rank] &&
      units + training >= armyCap
    ) {
      continue;
    }

    const forceRecruit =
      expanding ||
      bottled ||
      units + training === 0 ||
      threatened ||
      needCounter ||
      live.money >= cost * 2;

    const want =
      forceRecruit ||
      units + training < armyCap ||
      live.money > cost + 16 + profile.reserveMoney;

    if (!want) continue;
    if (Math.random() < profile.mistakeChance * 0.4) continue;

    game.summonAt(key);
  }
}

function countOwnedUnits(game: Game, hexes: string[], owner: PlayerId): number {
  let n = 0;
  for (const h of hexes) {
    const u = game.cells[h].unit;
    if (u && u.owner === owner) n += 1;
  }
  return n;
}

function maxEnemyUnitRank(game: Game, owner: PlayerId): number {
  let max = 0;
  for (const key in game.cells) {
    const cell = game.cells[key];
    const u = cell.unit;
    if (!u || u.owner === owner || u.owner === 0) continue;
    if (game.isAlly(owner, u.owner)) continue;
    if (u.rank > max) max = u.rank;
  }
  return max;
}

function hasNeutralAdjacent(game: Game, hexes: string[], owner: PlayerId): boolean {
  for (const key of hexes) {
    const c = game.cells[key];
    for (const n of hexNeighbors(c.q, c.r)) {
      const nc = game.cells[cellKey(n.q, n.r)];
      if (nc && nc.owner === 0) return true;
    }
  }
  void owner;
  return false;
}

/** No neutrals left to grab and most of the border touches enemies — bottled up. */
function isContained(game: Game, hexes: string[], owner: PlayerId): boolean {
  if (hexes.length === 0) return false;
  if (hasNeutralAdjacent(game, hexes, owner)) return false;
  let border = 0;
  let enemyTouch = 0;
  for (const key of hexes) {
    if (!isBorderHex(game, key, owner)) continue;
    border += 1;
    const c = game.cells[key];
    for (const n of hexNeighbors(c.q, c.r)) {
      const nc = game.cells[cellKey(n.q, n.r)];
      if (nc && nc.owner !== 0 && nc.owner !== owner && !game.isAlly(owner, nc.owner)) {
        enemyTouch += 1;
        break;
      }
    }
  }
  return border > 0 && enemyTouch / border >= 0.45;
}

/** Strongest enemy fortification sitting on our border. */
function enemyBorderDefense(game: Game, hexes: string[], owner: PlayerId): number {
  let max = 0;
  for (const key of hexes) {
    const c = game.cells[key];
    for (const n of hexNeighbors(c.q, c.r)) {
      const nc = game.cells[cellKey(n.q, n.r)];
      if (!nc || nc.owner === 0 || nc.owner === owner) continue;
      if (game.isAlly(owner, nc.owner)) continue;
      if (nc.building) {
        max = Math.max(max, BUILDING_PROTECTION[nc.building] ?? 0);
      }
      if (nc.unit) max = Math.max(max, nc.unit.rank);
    }
  }
  return max;
}

function breakRankNeeded(wallDef: number): UnitRank {
  if (wallDef >= 3) return 4;
  if (wallDef >= 2) return 3;
  return 2;
}

function enemyAssetValue(building: BuildingKind | null, bottled = false): number {
  if (!building) return 0;
  if (building === 'castle') return 95;
  if (isHouseBuilding(building)) return 60;
  if (building === 'farm') return 42;
  // Towers are the seal — worth much more when bottled
  if (building === 'tower') return bottled ? 70 : 28;
  if (building === 'strongTower') return bottled ? 85 : 34;
  return 0;
}

/** Prefer hexes that sit next to / closer to enemy farms, houses, castles. */
function approachEnemyAssetsBonus(game: Game, playerId: PlayerId, toKey: string): number {
  const start = game.cells[toKey];
  if (!start) return 0;

  let best = 0;
  for (const n of hexNeighbors(start.q, start.r)) {
    const nc = game.cells[cellKey(n.q, n.r)];
    if (!nc || nc.owner === 0 || nc.owner === playerId) continue;
    if (game.isAlly(playerId, nc.owner)) continue;
    best = Math.max(best, enemyAssetValue(nc.building) * 0.55);
  }

  const queue: { key: string; dist: number }[] = [{ key: toKey, dist: 0 }];
  const seen = new Set<string>([toKey]);
  while (queue.length) {
    const { key, dist } = queue.shift()!;
    if (dist >= 4) continue;
    const cell = game.cells[key];
    for (const n of hexNeighbors(cell.q, cell.r)) {
      const nk = cellKey(n.q, n.r);
      if (seen.has(nk)) continue;
      const nc = game.cells[nk];
      if (!nc) continue;
      if (nc.owner !== 0 && nc.owner !== playerId && !game.isAlly(playerId, nc.owner)) {
        seen.add(nk);
        const asset = enemyAssetValue(nc.building);
        if (asset > 0) best = Math.max(best, asset * (1 - dist * 0.18));
        queue.push({ key: nk, dist: dist + 1 });
      }
    }
  }
  return best;
}

/** After capturing this enemy hex, how soon do we reach open neutrals? */
function breakoutTowardNeutralBonus(game: Game, playerId: PlayerId, toKey: string): number {
  const queue: { key: string; dist: number }[] = [{ key: toKey, dist: 0 }];
  const seen = new Set<string>([toKey]);
  while (queue.length) {
    const { key, dist } = queue.shift()!;
    if (dist > 5) continue;
    const cell = game.cells[key];
    for (const n of hexNeighbors(cell.q, cell.r)) {
      const nk = cellKey(n.q, n.r);
      if (seen.has(nk)) continue;
      const nc = game.cells[nk];
      if (!nc) continue;
      if (nc.owner === 0) return 55 - dist * 8;
      if (nc.owner !== playerId && !game.isAlly(playerId, nc.owner)) {
        seen.add(nk);
        queue.push({ key: nk, dist: dist + 1 });
      }
    }
  }
  return 0;
}

/** How many neutrals open up if we claim this hex (wide frontier). */
function neutralFrontierValue(game: Game, toKey: string): number {
  const start = game.cells[toKey];
  if (!start) return 0;
  let count = 0;
  const seen = new Set<string>([toKey]);
  const queue: { key: string; dist: number }[] = [{ key: toKey, dist: 0 }];
  while (queue.length) {
    const { key, dist } = queue.shift()!;
    if (dist >= 3) continue;
    const cell = game.cells[key];
    for (const n of hexNeighbors(cell.q, cell.r)) {
      const nk = cellKey(n.q, n.r);
      if (seen.has(nk)) continue;
      const nc = game.cells[nk];
      if (!nc || nc.owner !== 0) continue;
      seen.add(nk);
      count += 1;
      queue.push({ key: nk, dist: dist + 1 });
    }
  }
  return Math.min(22, count * 2.2);
}

function isThreatened(game: Game, hexes: string[], owner: PlayerId): boolean {
  for (const key of hexes) {
    const c = game.cells[key];
    for (const n of hexNeighbors(c.q, c.r)) {
      const nc = game.cells[cellKey(n.q, n.r)];
      if (nc && nc.owner !== 0 && nc.owner !== owner && !game.isAlly(owner, nc.owner)) {
        return true;
      }
    }
  }
  return false;
}

function enemyUnitAdjacent(game: Game, hexes: string[], owner: PlayerId): boolean {
  for (const key of hexes) {
    const c = game.cells[key];
    for (const n of hexNeighbors(c.q, c.r)) {
      const nc = game.cells[cellKey(n.q, n.r)];
      if (
        nc &&
        nc.owner !== 0 &&
        nc.owner !== owner &&
        !game.isAlly(owner, nc.owner) &&
        nc.unit
      ) {
        return true;
      }
    }
  }
  return false;
}

function isBorderHex(game: Game, key: string, owner: PlayerId): boolean {
  const c = game.cells[key];
  if (!c || c.owner !== owner) return false;
  return hexNeighbors(c.q, c.r).some((n) => {
    const nc = game.cells[cellKey(n.q, n.r)];
    return !nc || nc.owner !== owner;
  });
}

function isHotBorderHex(game: Game, key: string, owner: PlayerId): boolean {
  const c = game.cells[key];
  if (!c || c.owner !== owner) return false;
  return hexNeighbors(c.q, c.r).some((n) => {
    const nc = game.cells[cellKey(n.q, n.r)];
    return (
      !!nc &&
      nc.owner !== 0 &&
      nc.owner !== owner &&
      !game.isAlly(owner, nc.owner)
    );
  });
}

/** True if this hex already touches a tower (spacing: place through one cell). */
function adjacentToTower(game: Game, key: string): boolean {
  const c = game.cells[key];
  if (!c) return false;
  for (const n of hexNeighbors(c.q, c.r)) {
    const b = game.cells[cellKey(n.q, n.r)]?.building;
    if (b === 'tower' || b === 'strongTower') return true;
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
    const onEdge = isBorderHex(game, h, c.owner);
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
  const towers = prov.hexes.filter((h) => {
    const b = game.cells[h].building;
    return b === 'tower' || b === 'strongTower';
  }).length;
  const net = aiNet(game, prov);
  const hotFront = enemyUnitAdjacent(game, prov.hexes, prov.owner);
  const freeSlots = buildable.length;
  const units = countOwnedUnits(game, prov.hexes, prov.owner);
  const training = prov.hexes.filter((h) => game.cells[h].training).length;
  const underArmed =
    units + training < Math.max(1, Math.ceil(prov.hexes.length * profile.armyDensity));
  const enemyMax = maxEnemyUnitRank(game, prov.owner);
  const expanding = hasNeutralAdjacent(game, prov.hexes, prov.owner);
  const bottled = isContained(game, prov.hexes, prov.owner);
  const wallDef = enemyBorderDefense(game, prov.hexes, prov.owner);
  const needBreak = bottled || wallDef >= 2 ? breakRankNeeded(wallDef) : 0;
  const borderSlots = buildable.filter((h) => isBorderHex(game, h, prov.owner));
  const hotBorderSlots = buildable.filter((h) => isHotBorderHex(game, h, prov.owner));
  const interiorSlots = buildable.filter((h) => !isBorderHex(game, h, prov.owner));
  const borderHexes = prov.hexes.filter((h) => isBorderHex(game, h, prov.owner)).length;
  // One tower per ~2 border hexes (spacing handled separately)
  const towerCap = Math.max(hotFront || bottled ? 1 : 0, Math.ceil(borderHexes / 2));

  // --- Opening: farms on all but one free cell, then house on the last ---
  if (houses.length === 0) {
    const farmCostNow = farmCost(game.cells, prov);
    // Keep one slot for the house whenever possible
    if (freeSlots > 1 && prov.money >= farmCostNow) {
      if (
        place(
          game,
          pickBuildHex(game, interiorSlots.length ? interiorSlots : buildable, false),
          'buildFarm',
        )
      ) {
        return;
      }
    }
    if (prov.money >= HOUSE_COST[1] + Math.floor(profile.reserveMoney * 0.1)) {
      if (place(game, pickBuildHex(game, buildable, false), 'buildHouse1')) return;
    }
    return;
  }

  // --- Tech up houses (emergency HQ/factory when bottled behind towers) ---
  for (const rank of [4, 3, 2] as HouseRank[]) {
    const has = houses.some((h) => houseRankFromKind(game.cells[h].building!) === rank);
    if (has) continue;

    const needFarms = Math.max(0, rank - 2);
    const cost = HOUSE_COST[rank];
    if (prov.money < cost + profile.reserveMoney) continue;

    const counterEnemy =
      enemyMax >= rank - 1 ||
      (rank >= 3 && enemyMax >= 2) ||
      (needBreak > 0 && rank >= needBreak);
    const economyOk =
      farms >= needFarms ||
      net >= rank * 2 ||
      prov.money >= cost * 1.35 ||
      (needBreak > 0 && rank >= needBreak);
    const armyGateOk =
      rank === 2 ||
      !underArmed ||
      counterEnemy ||
      bottled ||
      net >= rank * 3 ||
      prov.money >= cost + UNIT_COST[rank] + 20;

    if (!economyOk || !armyGateOk) continue;
    if (
      rank >= 3 &&
      farms < needFarms &&
      !counterEnemy &&
      !bottled &&
      net < rank * 2
    ) {
      continue;
    }

    if (
      place(
        game,
        pickBuildHex(game, interiorSlots.length ? interiorSlots : buildable, false),
        `buildHouse${rank}` as SelectionMode,
      )
    ) {
      return;
    }
  }

  // Extra low-rank house when large / need more recruitment
  if (
    houses.length < Math.min(3, 1 + Math.floor(prov.hexes.length / 5)) &&
    freeSlots > 1 &&
    prov.money >= HOUSE_COST[1] + 12 + profile.reserveMoney &&
    net >= 5 &&
    (!underArmed || enemyMax >= 2 || bottled)
  ) {
    if (
      place(
        game,
        pickBuildHex(game, interiorSlots.length ? interiorSlots : buildable, false),
        'buildHouse1',
      )
    ) {
      return;
    }
  }

  // --- Defense on border, spaced every other cell ---
  if (
    towers < towerCap &&
    (hotBorderSlots.length > 0 || ((hotFront || bottled) && borderSlots.length > 0))
  ) {
    const rawPool = hotBorderSlots.length ? hotBorderSlots : borderSlots;
    const pool = rawPool.filter((h) => !adjacentToTower(game, h));
    if (pool.length) {
      const canStrong =
        prov.money >= STRONG_TOWER_COST + profile.reserveMoney &&
        (hotFront || bottled || profile.aggression >= 1);
      const canTower = prov.money >= TOWER_COST + Math.floor(profile.reserveMoney * 0.2);
      // When saving for breakout HQ, don't dump cash into own towers
      const savingForBreak =
        needBreak >= 3 &&
        !houses.some((h) => (houseRankFromKind(game.cells[h].building!) ?? 0) >= needBreak) &&
        prov.money < HOUSE_COST[needBreak as HouseRank] + 30;
      if (!savingForBreak && (canStrong || canTower)) {
        const mode: SelectionMode =
          canStrong && (hotFront || bottled || towers === 0)
            ? 'buildStrongTower'
            : 'buildTower';
        if (mode === 'buildStrongTower' || canTower) {
          if (place(game, pickBuildHex(game, pool, true), mode)) return;
        }
      }
    }
  }

  // --- Farms: skip / limit while saving for breakout HQ ---
  const savingForBreak =
    needBreak >= 3 &&
    !houses.some((h) => (houseRankFromKind(game.cells[h].building!) ?? 0) >= needBreak);
  if (savingForBreak && prov.money < HOUSE_COST[needBreak as HouseRank] + 40) {
    // Only farm if very poor income — otherwise bank for HQ/factory
    if (net >= 6) return;
  }

  if (
    !profile.expandFirst ||
    pass >= profile.buildPasses - 2 ||
    !underArmed ||
    net < 4 ||
    expanding ||
    bottled
  ) {
    if (tryBuildFarm(game, provinceId, profile, interiorSlots, buildable)) return;
  } else if (difficulty !== 'expert' && pass === profile.buildPasses - 1) {
    if (tryBuildFarm(game, provinceId, profile, interiorSlots, buildable)) return;
  }
}

function tryBuildFarm(
  game: Game,
  provinceId: number,
  profile: AiProfile,
  interiorSlots: string[],
  buildable: string[],
): boolean {
  const prov = game.provinces.find((p) => p.id === provinceId);
  if (!prov || prov.owner !== game.currentPlayerId) return false;

  const houses = prov.hexes.filter((h) => isHouseBuilding(game.cells[h].building));
  if (houses.length === 0) return false;

  const farms = prov.hexes.filter((h) => game.cells[h].building === 'farm').length;
  const net = aiNet(game, prov);
  const units = countOwnedUnits(game, prov.hexes, prov.owner);
  const training = prov.hexes.filter((h) => game.cells[h].training).length;
  const idleHouse = houses.some((h) => !game.cells[h].training);
  const expanding = hasNeutralAdjacent(game, prov.hexes, prov.owner);
  const pool = interiorSlots.length ? interiorSlots : buildable;
  if (pool.length === 0) return false;

  // Prefer recruiting over farming when expanding and broke on units
  if (
    expanding &&
    idleHouse &&
    units + training === 0 &&
    prov.money >= UNIT_COST[1]
  ) {
    return false;
  }

  const interiorHexes = prov.hexes.filter((h) => !isBorderHex(game, h, prov.owner)).length;
  const farmTarget = Math.max(
    2,
    Math.floor(interiorHexes * 0.6),
    Math.floor(prov.hexes.length / 3),
  );
  const wantFarm = farms < farmTarget || net < 4 + profile.preferEconomy * 4;
  if (!wantFarm) return false;
  if (
    interiorSlots.length === 0 &&
    farms >= Math.max(1, Math.ceil(farmTarget * 0.5)) &&
    net >= 3
  ) {
    return false;
  }

  const cost = farmCost(game.cells, prov);
  const bottled = isContained(game, prov.hexes, prov.owner);
  const wallDef = enemyBorderDefense(game, prov.hexes, prov.owner);
  const needBreak = bottled || wallDef >= 2 ? breakRankNeeded(wallDef) : 0;
  const hasBreaker = houses.some(
    (h) => (houseRankFromKind(game.cells[h].building!) ?? 0) >= Math.max(needBreak, 3),
  );
  // Bank for HQ/factory instead of endless farms while sealed
  if (needBreak >= 3 && !hasBreaker && prov.money >= HOUSE_COST[3] - 10) {
    return false;
  }
  const reserve =
    expanding && idleHouse
      ? UNIT_COST[1]
      : bottled && !hasBreaker
        ? Math.min(prov.money, HOUSE_COST[3] * 0.15)
        : Math.floor(profile.reserveMoney * 0.2);
  if (prov.money < cost + reserve) return false;

  return place(game, pickBuildHex(game, pool, false), 'buildFarm');
}

function maybeBuildFarmOnly(game: Game, provinceId: number, profile: AiProfile): void {
  const prov = game.provinces.find((p) => p.id === provinceId);
  if (!prov || prov.owner !== game.currentPlayerId) return;

  const buildable = prov.hexes.filter((h) => {
    const c = game.cells[h];
    return !c.unit && !c.building;
  });
  if (buildable.length === 0) return;

  const interiorSlots = buildable.filter((h) => !isBorderHex(game, h, prov.owner));
  tryBuildFarm(game, provinceId, profile, interiorSlots, buildable);
}

function place(game: Game, hexKey: string, mode: SelectionMode): boolean {
  return game.buildAt(hexKey, mode);
}
