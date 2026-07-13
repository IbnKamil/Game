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
  },
  normal: {
    mistakeChance: 0.08,
    skipMoveChance: 0.05,
    buildPasses: 2,
    reserveMoney: 6,
    aggression: 0.8,
    preferEconomy: 0.75,
    maxMoves: 18,
  },
  hard: {
    mistakeChance: 0.02,
    skipMoveChance: 0.01,
    buildPasses: 3,
    reserveMoney: 4,
    aggression: 0.95,
    preferEconomy: 0.9,
    maxMoves: 28,
  },
  expert: {
    mistakeChance: 0,
    skipMoveChance: 0,
    buildPasses: 3,
    reserveMoney: 2,
    aggression: 1,
    preferEconomy: 1,
    maxMoves: 36,
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
    for (let pass = 0; pass < profile.buildPasses; pass++) {
      for (const prov of [...provincesOfPlayer(game.provinces, playerId)].sort(
        (a, b) => b.hexes.length - a.hexes.length,
      )) {
        maybeBuild(game, prov.id, profile);
      }
    }

    for (const prov of provincesOfPlayer(game.provinces, playerId)) {
      maybeSummon(game, prov.id, profile, difficulty);
    }

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

      let best = targets[0];
      let bestScore = scoreMove(game, playerId, fromKey, best, profile);
      for (let i = 1; i < targets.length; i++) {
        const s = scoreMove(game, playerId, fromKey, targets[i], profile);
        if (s > bestScore) {
          bestScore = s;
          best = targets[i];
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

      // Always take clearly good moves; otherwise expand with aggression
      if (bestScore >= 8 || Math.random() < profile.aggression) {
        game.moveUnitTo(fromKey, chosen);
        moved += 1;
      }
    }

    game.clearSelection();
  } finally {
    game.endBatch();
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

  if (cell.owner !== 0 && cell.owner !== playerId) {
    s += 45 * profile.aggression;
    if (cell.building === 'castle') s += 70;
    else if (isHouseBuilding(cell.building)) s += 40;
    else if (cell.building === 'farm') s += 28;
    else if (cell.building === 'tower' || cell.building === 'strongTower') s += 18;
    if (cell.unit) {
      s += 12 + cell.unit.rank * 6;
      // Prefer fights we win cleanly (higher rank / bigger stack)
      if (unit.rank > cell.unit.rank) s += 20;
      else if (unit.rank === cell.unit.rank && (unit.count ?? 1) > (cell.unit.count ?? 1)) {
        s += 10;
      }
    }
    // Bonus for capturing hexes that grow a small province
    const myProv = game.getProvince(fromKey);
    if (myProv && myProv.hexes.length <= 4) s += 15;
    return s;
  }

  if (cell.owner === 0) {
    s += 18 + profile.aggression * 10;
    // Prefer neutral hexes that touch enemies (frontline expansion)
    let touchesEnemy = false;
    let touchesMine = false;
    for (const n of hexNeighbors(cell.q, cell.r)) {
      const nc = game.cells[cellKey(n.q, n.r)];
      if (!nc) continue;
      if (nc.owner !== 0 && nc.owner !== playerId) touchesEnemy = true;
      if (nc.owner === playerId) touchesMine = true;
    }
    if (touchesEnemy) s += 14 * profile.aggression;
    if (touchesMine) s += 4;
    if (cell.tree) s += 3 * profile.preferEconomy;
    return s;
  }

  // Own territory
  if (cell.unit && cell.unit.rank === unit.rank) {
    // Merge stacks — stronger groups win same-rank fights
    s += 6 + Math.min(8, (unit.count ?? 1) + (cell.unit.count ?? 1));
  } else if (cell.tree) {
    s += 5 * profile.preferEconomy;
  } else {
    s += 1;
  }

  // Step toward the front if idle
  for (const n of hexNeighbors(cell.q, cell.r)) {
    const nc = game.cells[cellKey(n.q, n.r)];
    if (nc && nc.owner !== 0 && nc.owner !== playerId) {
      s += 8 * profile.aggression;
      break;
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
  const threatened = isThreatened(game, prov.hexes, prov.owner);
  const net = netIncome(game.cells, prov);

  for (const key of ordered) {
    const cell = game.cells[key];
    if (!isHouseBuilding(cell.building) || cell.training) continue;
    const rank = houseRankFromKind(cell.building!) as UnitRank;
    const live = game.provinces.find((x) => x.id === provinceId);
    if (!live) continue;

    const cost = UNIT_COST[rank];
    // No army yet: spend almost everything on the first recruit
    const reserve =
      units === 0 ? Math.min(2, profile.reserveMoney) : profile.reserveMoney;
    if (live.money < cost + reserve) continue;

    // Don't bankrupt income with expensive upkeep on easy
    if (difficulty === 'easy' && rank >= 3 && net < 6) continue;

    const armyCap = Math.max(
      1,
      Math.floor(prov.hexes.length / (difficulty === 'easy' ? 5 : difficulty === 'normal' ? 3 : 2.5)),
    );
    const want =
      units === 0 ||
      threatened ||
      units < armyCap ||
      live.money > cost + 20 + profile.reserveMoney ||
      (net >= UNIT_COST[1] && units < armyCap + 1);

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

/**
 * Build priority:
 * 1) Recruitment house before farms can fill a tiny starting province.
 * 2) Upgrade / extra houses when economy allows.
 * 3) Towers only when threatened.
 * 4) Farms after at least one house exists (or on large provinces with a reserved slot).
 */
function maybeBuild(game: Game, provinceId: number, profile: AiProfile): void {
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
  const freeSlots = buildable.length;

  // --- No recruitment house yet: never seal the province with farms ---
  if (houses.length === 0) {
    const houseNeed = HOUSE_COST[1] + Math.floor(profile.reserveMoney * 0.1);
    if (prov.money >= houseNeed) {
      place(game, pickBuildHex(game, buildable, false), 'buildHouse1');
      return;
    }

    // Starting 3-hex provinces (castle + 2 free): save for a house, do not farm.
    // Also reserve the last buildable tile on any province until a house exists.
    const scarceLand = freeSlots <= 2 || prov.hexes.length <= 4;
    if (scarceLand) return;

    // Large province: one farm is OK if we still leave a house slot.
    if (freeSlots > 1 && net < 5) {
      const cost = farmCost(game.cells, prov);
      if (prov.money >= cost) {
        place(game, pickBuildHex(game, buildable, false), 'buildFarm');
      }
    }
    return;
  }

  // --- Have at least one house ---

  // Upgrade to higher houses when farms/income support them
  for (const rank of [4, 3, 2] as HouseRank[]) {
    const has = houses.some((h) => houseRankFromKind(game.cells[h].building!) === rank);
    const needFarms = Math.max(0, rank - 2);
    if (
      !has &&
      farms >= needFarms &&
      net >= rank * 2 &&
      prov.money >= HOUSE_COST[rank] + profile.reserveMoney
    ) {
      place(game, pickBuildHex(game, buildable, false), `buildHouse${rank}` as SelectionMode);
      return;
    }
  }

  // Extra house1 if rich and expanding
  if (
    houses.length < Math.min(3, 1 + Math.floor(prov.hexes.length / 6)) &&
    freeSlots > 1 &&
    prov.money >= HOUSE_COST[1] + 15 + profile.reserveMoney &&
    net >= 6
  ) {
    place(game, pickBuildHex(game, buildable, false), 'buildHouse1');
    return;
  }

  // Defense when under pressure — keep a free slot if we still need economy space
  if (threatened && prov.money >= TOWER_COST + profile.reserveMoney * 0.25) {
    if (Math.random() < 0.4 + profile.aggression * 0.45) {
      const mode: SelectionMode =
        prov.money >= STRONG_TOWER_COST + profile.reserveMoney && profile.aggression > 0.75
          ? 'buildStrongTower'
          : 'buildTower';
      place(game, pickBuildHex(game, buildable, true), mode);
      return;
    }
  }

  // Farms after recruitment is online — don't fill the very last tile unless income is dire
  const farmTarget = Math.max(1, Math.floor(prov.hexes.length / 3));
  const wantFarm = farms < farmTarget || net < 4 + profile.preferEconomy * 4;
  if (wantFarm && (freeSlots > 1 || net < 2)) {
    const cost = farmCost(game.cells, prov);
    if (prov.money >= cost + Math.floor(profile.reserveMoney * 0.25)) {
      // Keep money for summoning if we have idle houses and no army
      const idleHouse = houses.some((h) => !game.cells[h].training);
      const units = prov.hexes.filter((h) => game.cells[h].unit).length;
      if (idleHouse && units === 0 && prov.money < UNIT_COST[1] + cost) {
        return;
      }
      place(game, pickBuildHex(game, buildable, false), 'buildFarm');
    }
  }
}

function place(game: Game, hexKey: string, mode: SelectionMode): void {
  game.buildAt(hexKey, mode);
}
