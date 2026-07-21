/**
 * Strategic AI architecture (Expert tier).
 *
 * Layers:
 *  1. Situation analysis → phase + focus target
 *  2. Economy planner → scored build/recruit actions
 *  3. Tactical combat → per-unit search over legal moves
 *  4. Alliance support → surplus transfer / front gifts
 *
 * Lower difficulties stay on the classic heuristic AI.
 */
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
  type BuildingKind,
  type HouseRank,
  type PlayerId,
  type Province,
  type SelectionMode,
  type UnitRank,
} from './types';

export type StrategicPhase = 'opening' | 'expand' | 'tech' | 'pressure' | 'breakout';

interface Situation {
  phase: StrategicPhase;
  focusEnemy: PlayerId | null;
  expanding: boolean;
  bottled: boolean;
  threatened: boolean;
  wallDef: number;
  needBreak: UnitRank;
  enemyMaxRank: number;
  myHexes: number;
  myUnits: number;
}

function aiNet(game: Game, prov: Province): number {
  return netIncome(game.cells, prov, game.farmBonusFor(prov.owner));
}

/** Entry point for Expert strategic AI. */
export function runStrategicAiTurn(game: Game, playerId: PlayerId): void {
  if (game.winnerId || game.currentPlayerId !== playerId) return;
  if (game.currentPlayer().isHuman) return;
  if (provincesOfPlayer(game.provinces, playerId).length === 0) return;

  game.beginBatch();
  try {
    const sit = analyzeSituation(game, playerId);

    // Economy passes (planner picks highest-utility affordable action)
    for (let pass = 0; pass < 10; pass++) {
      let acted = false;
      for (const prov of sortedProvinces(game, playerId)) {
        if (planProvinceEconomy(game, prov.id, sit)) acted = true;
      }
      if (!acted) break;
    }

    // Recruit wave
    for (const prov of sortedProvinces(game, playerId)) {
      planRecruit(game, prov.id, sit);
    }

    // Combat search
    planCombat(game, playerId, sit);

    // Second economy + recruit + combat (cash left after first wave)
    for (let pass = 0; pass < 4; pass++) {
      let acted = false;
      for (const prov of sortedProvinces(game, playerId)) {
        if (planProvinceEconomy(game, prov.id, sit)) acted = true;
      }
      if (!acted) break;
    }
    for (const prov of sortedProvinces(game, playerId)) {
      planRecruit(game, prov.id, sit);
    }
    planCombat(game, playerId, sit);

    supportAllies(game, playerId);
    game.clearSelection();
  } finally {
    game.endBatch();
  }
}

function sortedProvinces(game: Game, playerId: PlayerId): Province[] {
  return [...provincesOfPlayer(game.provinces, playerId)].sort(
    (a, b) => b.hexes.length - a.hexes.length || b.money - a.money,
  );
}

// ---------------------------------------------------------------------------
// Layer 1 — situation analysis
// ---------------------------------------------------------------------------

function analyzeSituation(game: Game, playerId: PlayerId): Situation {
  const provinces = provincesOfPlayer(game.provinces, playerId);
  let myHexes = 0;
  let myUnits = 0;
  let houses = 0;
  let farms = 0;
  let expanding = false;
  let bottled = true;
  let threatened = false;
  let wallDef = 0;

  for (const prov of provinces) {
    myHexes += prov.hexes.length;
    for (const h of prov.hexes) {
      const c = game.cells[h];
      if (c.unit?.owner === playerId) myUnits += 1;
      if (isHouseBuilding(c.building)) houses += 1;
      if (c.building === 'farm') farms += 1;
    }
    if (hasNeutralAdjacent(game, prov.hexes)) {
      expanding = true;
      bottled = false;
    }
    if (enemyTouches(game, prov.hexes, playerId)) threatened = true;
    wallDef = Math.max(wallDef, enemyBorderDefense(game, prov.hexes, playerId));
  }

  if (expanding) bottled = false;
  else bottled = isContained(game, provinces.flatMap((p) => p.hexes), playerId);

  const enemyMaxRank = maxEnemyUnitRank(game, playerId);
  const needBreak: UnitRank =
    bottled || wallDef >= 2 ? (wallDef >= 3 ? 4 : wallDef >= 2 ? 3 : 2) : 1;

  let phase: StrategicPhase;
  if (houses === 0 || (houses === 1 && farms < 2 && myHexes <= 6)) {
    phase = 'opening';
  } else if (bottled) {
    phase = 'breakout';
  } else if (
    enemyMaxRank >= 3 ||
    needBreak >= 3 ||
    (threatened && enemyMaxRank >= 2 && !hasHouseRank(game, provinces, 3))
  ) {
    phase = 'tech';
  } else if (expanding && myHexes < 18) {
    phase = 'expand';
  } else {
    phase = 'pressure';
  }

  return {
    phase,
    focusEnemy: chooseFocusEnemy(game, playerId),
    expanding,
    bottled,
    threatened,
    wallDef,
    needBreak,
    enemyMaxRank,
    myHexes,
    myUnits,
  };
}

function chooseFocusEnemy(game: Game, playerId: PlayerId): PlayerId | null {
  type Cand = { id: PlayerId; score: number };
  const cands: Cand[] = [];

  for (const p of game.players) {
    if (!p.alive || p.id === playerId || p.id === 0) continue;
    if (game.isAlly(playerId, p.id)) continue;

    const provs = provincesOfPlayer(game.provinces, p.id);
    if (provs.length === 0) continue;

    let hexes = 0;
    let farms = 0;
    let money = 0;
    let borderTouch = 0;
    for (const pr of provs) {
      hexes += pr.hexes.length;
      money += pr.money;
      for (const h of pr.hexes) {
        if (game.cells[h].building === 'farm') farms += 1;
        const c = game.cells[h];
        for (const n of hexNeighbors(c.q, c.r)) {
          const nc = game.cells[cellKey(n.q, n.r)];
          if (nc && (nc.owner === playerId || game.isAlly(playerId, nc.owner))) {
            borderTouch += 1;
            break;
          }
        }
      }
    }

    let score = hexes * 3 + farms * 12 + money * 0.35 + borderTouch * 8;
    if (p.isHuman) score += 80;
    // Prefer already-adjacent foes (finish the fight in front of you)
    if (borderTouch > 0) score += 40;
    cands.push({ id: p.id, score });
  }

  cands.sort((a, b) => b.score - a.score);
  return cands[0]?.id ?? null;
}

function hasHouseRank(game: Game, provinces: Province[], rank: HouseRank): boolean {
  for (const prov of provinces) {
    for (const h of prov.hexes) {
      if (houseRankFromKind(game.cells[h].building!) === rank) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Layer 2 — economy planner
// ---------------------------------------------------------------------------

interface EcoAction {
  utility: number;
  run: () => boolean;
}

function planProvinceEconomy(game: Game, provinceId: number, sit: Situation): boolean {
  const prov = game.provinces.find((p) => p.id === provinceId);
  if (!prov || prov.owner !== game.currentPlayerId) return false;

  const buildable = prov.hexes.filter((h) => {
    const c = game.cells[h];
    return !c.unit && !c.building;
  });
  const houses = prov.hexes.filter((h) => isHouseBuilding(game.cells[h].building));
  const farms = prov.hexes.filter((h) => game.cells[h].building === 'farm').length;
  const towers = prov.hexes.filter((h) => {
    const b = game.cells[h].building;
    return b === 'tower' || b === 'strongTower';
  }).length;
  const interior = buildable.filter((h) => !isBorderHex(game, h, prov.owner));
  const hotBorder = buildable.filter((h) => isHotBorderHex(game, h, prov.owner));
  const border = buildable.filter((h) => isBorderHex(game, h, prov.owner));
  const net = aiNet(game, prov);
  const actions: EcoAction[] = [];

  // --- Opening: carpet farms, leave 1 slot for house ---
  if (houses.length === 0) {
    const cost = farmCost(game.cells, prov);
    if (buildable.length > 1 && prov.money >= cost) {
      const hex = pickHex(interior.length ? interior : buildable, false);
      actions.push({
        utility: 900,
        run: () => game.buildAt(hex, 'buildFarm'),
      });
    }
    if (prov.money >= HOUSE_COST[1] && buildable.length >= 1) {
      const hex = pickHex(buildable, false);
      actions.push({
        utility: 850,
        run: () => game.buildAt(hex, 'buildHouse1'),
      });
    }
    return executeBest(actions);
  }

  // --- Breakout / tech: rush HQ / factory ---
  for (const rank of [4, 3, 2] as HouseRank[]) {
    if (houses.some((h) => houseRankFromKind(game.cells[h].building!) === rank)) continue;
    const cost = HOUSE_COST[rank];
    if (prov.money < cost) continue;
    if (buildable.length === 0) continue;

    const needFarms = Math.max(0, rank - 2);
    const want =
      sit.phase === 'breakout' && rank >= sit.needBreak
        ? true
        : sit.phase === 'tech' && rank >= Math.min(4, sit.enemyMaxRank + 1)
          ? true
          : rank === 2 && (sit.phase === 'expand' || sit.phase === 'pressure' || farms >= 1)
            ? true
            : rank >= 3 && (farms >= needFarms || prov.money >= cost * 1.2 || sit.enemyMaxRank >= 2);

    if (!want) continue;

    let utility = 200 + rank * 80;
    if (sit.phase === 'breakout' && rank >= sit.needBreak) utility += 400;
    if (sit.phase === 'tech' && rank >= 3) utility += 250;
    if (rank === 2 && sit.expanding) utility += 120;

    const hex = pickHex(interior.length ? interior : buildable, false);
    actions.push({
      utility,
      run: () => game.buildAt(hex, `buildHouse${rank}` as SelectionMode),
    });
  }

  // Extra house1 for recruitment throughput
  if (
    houses.length < Math.min(3, 1 + Math.floor(prov.hexes.length / 5)) &&
    buildable.length > 1 &&
    prov.money >= HOUSE_COST[1] + 10 &&
    net >= 4
  ) {
    const hex = pickHex(interior.length ? interior : buildable, false);
    actions.push({
      utility: 160,
      run: () => game.buildAt(hex, 'buildHouse1'),
    });
  }

  // Border defense (spaced)
  const borderHexes = prov.hexes.filter((h) => isBorderHex(game, h, prov.owner)).length;
  const towerCap = Math.max(sit.threatened || sit.bottled ? 1 : 0, Math.ceil(borderHexes / 2));
  if (towers < towerCap && (hotBorder.length || ((sit.threatened || sit.bottled) && border.length))) {
    const pool = (hotBorder.length ? hotBorder : border).filter((h) => !adjacentToTower(game, h));
    if (pool.length) {
      const savingBreak =
        sit.phase === 'breakout' &&
        !houses.some((h) => (houseRankFromKind(game.cells[h].building!) ?? 0) >= sit.needBreak) &&
        prov.money < HOUSE_COST[sit.needBreak as HouseRank] + 25;
      if (!savingBreak) {
        const hex = pickHex(pool, true);
        if (prov.money >= STRONG_TOWER_COST && (sit.threatened || sit.bottled || towers === 0)) {
          actions.push({
            utility: 140 + (sit.threatened ? 40 : 0),
            run: () => game.buildAt(hex, 'buildStrongTower'),
          });
        } else if (prov.money >= TOWER_COST) {
          actions.push({
            utility: 110 + (sit.threatened ? 30 : 0),
            run: () => game.buildAt(hex, 'buildTower'),
          });
        }
      }
    }
  }

  // Farms — skip while banking for breakout HQ
  const savingBreak =
    sit.phase === 'breakout' &&
    !houses.some((h) => (houseRankFromKind(game.cells[h].building!) ?? 0) >= sit.needBreak) &&
    prov.money >= HOUSE_COST[3] - 15;
  if (!savingBreak || net < 5) {
    const pool = interior.length ? interior : buildable;
    if (pool.length) {
      const interiorHexes = prov.hexes.filter((h) => !isBorderHex(game, h, prov.owner)).length;
      const farmTarget = Math.max(3, Math.floor(interiorHexes * 0.85), Math.floor(prov.hexes.length / 2));
      const cost = farmCost(game.cells, prov);
      const reserve =
        sit.expanding && houses.some((h) => !game.cells[h].training) ? UNIT_COST[1] : 0;
      if (prov.money >= cost + reserve && (farms < farmTarget || net < 8)) {
        const hex = pickHex(pool, false);
        let utility = 90 + (farmTarget - farms) * 8;
        if (sit.phase === 'opening' || sit.phase === 'expand') utility += 50;
        if (sit.phase === 'pressure') utility += 30;
        actions.push({
          utility,
          run: () => game.buildAt(hex, 'buildFarm'),
        });
      }
    }
  }

  return executeBest(actions);
}

function executeBest(actions: EcoAction[]): boolean {
  if (actions.length === 0) return false;
  actions.sort((a, b) => b.utility - a.utility);
  for (const a of actions) {
    if (a.run()) return true;
  }
  return false;
}

function planRecruit(game: Game, provinceId: number, sit: Situation): void {
  const prov = game.provinces.find((p) => p.id === provinceId);
  if (!prov || prov.owner !== game.currentPlayerId) return;

  const houseKeys = prov.hexes
    .filter((h) => isHouseBuilding(game.cells[h].building) && !game.cells[h].training)
    .sort((a, b) => {
      const ra = houseRankFromKind(game.cells[a].building!) ?? 0;
      const rb = houseRankFromKind(game.cells[b].building!) ?? 0;
      return rb - ra;
    });
  if (houseKeys.length === 0) return;

  const units = countUnits(game, prov.hexes, prov.owner);
  const training = prov.hexes.filter((h) => game.cells[h].training).length;
  const density =
    sit.phase === 'breakout' || sit.phase === 'pressure'
      ? 1.05
      : sit.phase === 'expand'
        ? 0.9
        : 0.7;
  const armyCap = Math.max(2, Math.ceil(prov.hexes.length * density));
  const net = aiNet(game, prov);
  const maxHouse = Math.max(
    0,
    ...houseKeys.map((h) => houseRankFromKind(game.cells[h].building!) ?? 0),
  );

  for (const key of houseKeys) {
    const live = game.provinces.find((x) => x.id === provinceId);
    if (!live) return;
    const rank = houseRankFromKind(game.cells[key].building!) as UnitRank;
    const cost = UNIT_COST[rank];
    if (live.money < cost) continue;

    // Save for breaker units when sealed
    if (
      sit.phase === 'breakout' &&
      sit.needBreak >= 3 &&
      maxHouse >= sit.needBreak &&
      rank < sit.needBreak &&
      live.money < cost + UNIT_COST[sit.needBreak]
    ) {
      continue;
    }

    const needCounter = sit.enemyMaxRank >= rank || (sit.needBreak > 0 && rank >= sit.needBreak);
    const underArmed = units + training < armyCap;
    const canAffordUpkeep = net >= UNIT_UPKEEP[rank] * 0.35 || rank <= 2 || needCounter;

    const want =
      sit.phase === 'opening' ||
      sit.phase === 'expand' ||
      sit.phase === 'breakout' ||
      sit.phase === 'pressure' ||
      underArmed ||
      needCounter ||
      live.money >= cost * 2;

    if (!want || !canAffordUpkeep) continue;
    if (units + training >= armyCap + 3 && !needCounter && sit.phase !== 'breakout') continue;

    game.summonAt(key);
  }
}

// ---------------------------------------------------------------------------
// Layer 3 — tactical combat search
// ---------------------------------------------------------------------------

function planCombat(game: Game, playerId: PlayerId, sit: Situation): void {
  const unitKeys: string[] = [];
  for (const key in game.cells) {
    const u = game.cells[key].unit;
    if (u && u.owner === playerId && !u.moved) unitKeys.push(key);
  }

  unitKeys.sort((a, b) => {
    const ua = game.cells[a].unit!;
    const ub = game.cells[b].unit!;
    return ub.rank - ua.rank || (ub.count ?? 1) - (ua.count ?? 1);
  });

  let moved = 0;
  const maxMoves = 220;
  for (const fromKey of unitKeys) {
    if (moved >= maxMoves) break;
    const unit = game.cells[fromKey]?.unit;
    if (!unit || unit.moved || unit.owner !== playerId) continue;

    const targets = [...game.moveTargets(fromKey)];
    if (targets.length === 0) continue;

    let best = targets[0]!;
    let bestScore = scoreTacticalMove(game, playerId, fromKey, best, sit);
    for (let i = 1; i < targets.length; i++) {
      const s = scoreTacticalMove(game, playerId, fromKey, targets[i]!, sit);
      if (s > bestScore) {
        bestScore = s;
        best = targets[i]!;
      }
    }

    // Always take productive moves; also force expand/capture if available
    const offensive = targets.filter((t) => {
      const c = game.cells[t];
      return !!c && (c.owner === 0 || (c.owner !== playerId && !game.isAlly(playerId, c.owner)));
    });

    if (bestScore > -5) {
      game.moveUnitTo(fromKey, best);
      moved += 1;
    } else if (offensive.length) {
      let oBest = offensive[0]!;
      let oScore = scoreTacticalMove(game, playerId, fromKey, oBest, sit);
      for (let i = 1; i < offensive.length; i++) {
        const s = scoreTacticalMove(game, playerId, fromKey, offensive[i]!, sit);
        if (s > oScore) {
          oScore = s;
          oBest = offensive[i]!;
        }
      }
      game.moveUnitTo(fromKey, oBest);
      moved += 1;
    }
  }
}

function scoreTacticalMove(
  game: Game,
  playerId: PlayerId,
  fromKey: string,
  toKey: string,
  sit: Situation,
): number {
  const from = game.cells[fromKey];
  const to = game.cells[toKey];
  const unit = from?.unit;
  if (!from || !to || !unit) return -100;

  let s = 0;
  const focus = sit.focusEnemy;

  // --- Capture enemy ---
  if (to.owner !== 0 && to.owner !== playerId && !game.isAlly(playerId, to.owner)) {
    s += 120;
    s += assetValue(to.building, sit.phase === 'breakout') * 1.3;
    if (to.unit) {
      s += 30 + to.unit.rank * 22;
      if (unit.rank > to.unit.rank) s += 50;
      else if (unit.rank === to.unit.rank && (unit.count ?? 1) > (to.unit.count ?? 1)) s += 35;
    } else {
      s += 18;
    }
    if (focus !== null && to.owner === focus) s += 70;
    const owner = game.players.find((p) => p.id === to.owner);
    if (owner?.isHuman) s += 55;
    if (sit.phase === 'breakout') {
      s += 45;
      s += breakoutNeutralBonus(game, playerId, toKey);
    }
    s += approachFocusBonus(game, toKey, focus) * 0.5;
    // Small provinces: desperate expansion via capture
    const myProv = game.getProvince(fromKey);
    if (myProv && myProv.hexes.length <= 5) s += 40;
    return s;
  }

  // --- Ally land reposition ---
  if (to.owner !== 0 && to.owner !== playerId && game.isAlly(playerId, to.owner)) {
    s += 5;
    s += frontlineBonus(game, playerId, toKey, focus) * 1.2;
    s += approachFocusBonus(game, toKey, focus);
    return s;
  }

  // --- Neutral expand ---
  if (to.owner === 0) {
    s += 55;
    s += frontlineBonus(game, playerId, toKey, focus);
    s += approachFocusBonus(game, toKey, focus) * 0.8;
    s += neutralFrontierValue(game, toKey);
    if (sit.phase === 'expand' || sit.phase === 'opening') s += 25;
    if (to.tree) s += 4;
    // Prefer hexes that touch the focus enemy
    if (focus !== null) {
      for (const n of hexNeighbors(to.q, to.r)) {
        const nc = game.cells[cellKey(n.q, n.r)];
        if (nc?.owner === focus) {
          s += 35;
          break;
        }
      }
    }
    return s;
  }

  // --- Own land: merge / reposition ---
  if (to.unit && to.unit.rank === unit.rank) {
    const total = (unit.count ?? 1) + (to.unit.count ?? 1);
    s += 12 + Math.min(20, total * 3);
    s += frontlineBonus(game, playerId, toKey, focus) * 1.4;
  } else {
    s += 2;
    s += frontlineBonus(game, playerId, toKey, focus);
  }
  s += approachFocusBonus(game, toKey, focus) * 0.6;

  // Don't wander away from a hot fight
  if (sit.threatened && frontlineBonus(game, playerId, fromKey, focus) > frontlineBonus(game, playerId, toKey, focus)) {
    s -= 15;
  }

  return s;
}

function assetValue(building: BuildingKind | null, bottled: boolean): number {
  if (!building) return 0;
  if (building === 'castle') return 220;
  if (isHouseBuilding(building)) return 140;
  if (building === 'farm') return 95;
  if (building === 'tower') return bottled ? 130 : 50;
  if (building === 'strongTower') return bottled ? 160 : 60;
  return 0;
}

function frontlineBonus(
  game: Game,
  playerId: PlayerId,
  key: string,
  focus: PlayerId | null,
): number {
  const c = game.cells[key];
  if (!c) return 0;
  let s = 0;
  for (const n of hexNeighbors(c.q, c.r)) {
    const nc = game.cells[cellKey(n.q, n.r)];
    if (!nc) continue;
    if (nc.owner === 0) s += 4;
    if (nc.owner !== 0 && nc.owner !== playerId && !game.isAlly(playerId, nc.owner)) {
      s += 18;
      if (focus !== null && nc.owner === focus) s += 14;
      s += assetValue(nc.building, false) * 0.25;
    }
  }
  return s;
}

function approachFocusBonus(game: Game, key: string, focus: PlayerId | null): number {
  if (focus === null) return 0;
  const start = game.cells[key];
  if (!start) return 0;

  // BFS toward focus land (depth ≤ 5)
  const queue: { key: string; dist: number }[] = [{ key, dist: 0 }];
  const seen = new Set<string>([key]);
  while (queue.length) {
    const { key: k, dist } = queue.shift()!;
    if (dist >= 5) continue;
    const cell = game.cells[k];
    for (const n of hexNeighbors(cell.q, cell.r)) {
      const nk = cellKey(n.q, n.r);
      if (seen.has(nk)) continue;
      const nc = game.cells[nk];
      if (!nc) continue;
      seen.add(nk);
      if (nc.owner === focus) return 40 - dist * 7;
      queue.push({ key: nk, dist: dist + 1 });
    }
  }
  return 0;
}

function breakoutNeutralBonus(game: Game, playerId: PlayerId, toKey: string): number {
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
      if (nc.owner === 0) return 60 - dist * 9;
      if (nc.owner !== playerId && !game.isAlly(playerId, nc.owner)) {
        seen.add(nk);
        queue.push({ key: nk, dist: dist + 1 });
      }
    }
  }
  return 0;
}

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
  return Math.min(28, count * 2.5);
}

// ---------------------------------------------------------------------------
// Layer 4 — alliance support
// ---------------------------------------------------------------------------

function supportAllies(game: Game, playerId: PlayerId): void {
  const allies = game.players.filter(
    (p) => p.alive && p.id !== playerId && game.isAlly(playerId, p.id),
  );
  if (allies.length === 0) return;

  const mine = sortedProvinces(game, playerId);
  if (!mine.length) return;
  const rich = mine[0]!;
  const keep = 20;
  if (rich.money <= keep) return;

  let best: Province | null = null;
  let bestScore = Infinity;
  for (const ally of allies) {
    for (const prov of provincesOfPlayer(game.provinces, ally.id)) {
      const score = prov.money + prov.hexes.length * 2 + (ally.isHuman ? -50 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = prov;
      }
    }
  }
  if (!best) return;

  const gift = Math.floor((rich.money - keep) * 0.6);
  if (gift >= 8) game.transferMoney(rich.id, best.id, gift);

  // Gift a spare frontline unit already on ally land
  for (const key in game.cells) {
    const cell = game.cells[key];
    const u = cell.unit;
    if (!u || u.owner !== playerId || u.moved || u.rank < 2) continue;
    if (cell.owner === playerId || cell.owner === 0) continue;
    if (!game.isAlly(playerId, cell.owner)) continue;
    if (frontlineBonus(game, playerId, key, null) >= 18) {
      game.giftUnit(key, cell.owner);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Shared geometry / threat helpers
// ---------------------------------------------------------------------------

function pickHex(candidates: string[], preferBorder: boolean): string {
  if (candidates.length === 1) return candidates[0]!;
  const sorted = [...candidates].sort();
  // Slight bias: for borders take later keys, for interior take middle (stable)
  if (preferBorder) return sorted[sorted.length - 1]!;
  return sorted[Math.floor(sorted.length / 2)]!;
}

function countUnits(game: Game, hexes: string[], owner: PlayerId): number {
  let n = 0;
  for (const h of hexes) {
    if (game.cells[h].unit?.owner === owner) n += 1;
  }
  return n;
}

function hasNeutralAdjacent(game: Game, hexes: string[]): boolean {
  for (const key of hexes) {
    const c = game.cells[key];
    for (const n of hexNeighbors(c.q, c.r)) {
      const nc = game.cells[cellKey(n.q, n.r)];
      if (nc && nc.owner === 0) return true;
    }
  }
  return false;
}

function enemyTouches(game: Game, hexes: string[], owner: PlayerId): boolean {
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

function isContained(game: Game, hexes: string[], owner: PlayerId): boolean {
  if (hexes.length === 0) return false;
  if (hasNeutralAdjacent(game, hexes)) return false;
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

function enemyBorderDefense(game: Game, hexes: string[], owner: PlayerId): number {
  let max = 0;
  for (const key of hexes) {
    const c = game.cells[key];
    for (const n of hexNeighbors(c.q, c.r)) {
      const nc = game.cells[cellKey(n.q, n.r)];
      if (!nc || nc.owner === 0 || nc.owner === owner) continue;
      if (game.isAlly(owner, nc.owner)) continue;
      if (nc.building) max = Math.max(max, BUILDING_PROTECTION[nc.building] ?? 0);
      if (nc.unit) max = Math.max(max, nc.unit.rank);
    }
  }
  return max;
}

function maxEnemyUnitRank(game: Game, owner: PlayerId): number {
  let max = 0;
  for (const key in game.cells) {
    const u = game.cells[key].unit;
    if (!u || u.owner === owner || u.owner === 0) continue;
    if (game.isAlly(owner, u.owner)) continue;
    if (u.rank > max) max = u.rank;
  }
  return max;
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
    return !!nc && nc.owner !== 0 && nc.owner !== owner && !game.isAlly(owner, nc.owner);
  });
}

function adjacentToTower(game: Game, key: string): boolean {
  const c = game.cells[key];
  if (!c) return false;
  for (const n of hexNeighbors(c.q, c.r)) {
    const b = game.cells[cellKey(n.q, n.r)]?.building;
    if (b === 'tower' || b === 'strongTower') return true;
  }
  return false;
}
