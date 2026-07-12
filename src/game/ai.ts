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
import { cellKey, type HouseRank, type PlayerId, type UnitRank } from './types';

/** Simple heuristic AI for Antiyoy-style play with barracks. */
export function runAiTurn(game: Game, playerId: PlayerId): void {
  const provinces = provincesOfPlayer(game.provinces, playerId);
  if (provinces.length === 0) return;

  // 1) Build houses / farms / towers based on economy
  for (const prov of [...provinces].sort((a, b) => b.hexes.length - a.hexes.length)) {
    maybeBuild(game, prov.id);
  }

  // Refresh province refs after builds
  const fresh = provincesOfPlayer(game.provinces, playerId);

  // 2) Summon from idle houses when affordable
  for (const prov of fresh) {
    for (const key of prov.hexes) {
      const cell = game.cells[key];
      if (!isHouseBuilding(cell.building) || cell.training) continue;
      const rank = houseRankFromKind(cell.building!) as UnitRank;
      const p = game.provinces.find((x) => x.id === prov.id);
      if (!p || p.money < UNIT_COST[rank] + 5) continue;
      // Prefer summoning if we have few units or enemy nearby
      const units = prov.hexes.filter((h) => game.cells[h].unit).length;
      if (units < Math.max(2, Math.floor(prov.hexes.length / 4)) || p.money > 40) {
        game.ui = { selectedKey: key, mode: 'house', hoverKey: null };
        game.summonFromHouse();
      }
    }
  }

  // 3) Move units: expand / attack
  const unitKeys: string[] = [];
  for (const prov of provincesOfPlayer(game.provinces, playerId)) {
    for (const key of prov.hexes) {
      if (game.cells[key].unit && !game.cells[key].unit!.moved) unitKeys.push(key);
    }
  }

  for (const fromKey of unitKeys) {
    const targets = [...game.moveTargets(fromKey)];
    if (targets.length === 0) continue;

    // Prefer capturing enemy, then neutral, then cutting trees, then merge/move
    targets.sort((a, b) => scoreMove(game, playerId, a) - scoreMove(game, playerId, b));
    const best = targets[targets.length - 1];
    if (scoreMove(game, playerId, best) > 0 || Math.random() < 0.5) {
      game.ui = { selectedKey: fromKey, mode: 'unit', hoverKey: null };
      game.selectHex(best);
    }
  }

  game.clearSelection();
}

function scoreMove(game: Game, playerId: PlayerId, toKey: string): number {
  const cell = game.cells[toKey];
  if (!cell) return -10;
  if (cell.owner !== 0 && cell.owner !== playerId) {
    let s = 30 + (cell.building === 'farm' ? 20 : 0) + (cell.unit ? 10 : 0);
    // Prefer splitting / capital
    if (cell.building === 'castle') s += 40;
    return s;
  }
  if (cell.owner === 0) return 15;
  if (cell.tree) return 8;
  if (cell.unit) return 3; // merge
  return 1;
}

function maybeBuild(game: Game, provinceId: number): void {
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

  // Enemy adjacent?
  let threatened = false;
  for (const key of prov.hexes) {
    const c = game.cells[key];
    for (const n of hexNeighbors(c.q, c.r)) {
      const nc = game.cells[cellKey(n.q, n.r)];
      if (nc && nc.owner !== 0 && nc.owner !== prov.owner) threatened = true;
    }
  }

  const pick = empty[Math.floor(Math.random() * empty.length)];

  // Ensure at least one house1
  if (houses.length === 0 && prov.money >= HOUSE_COST[1]) {
    place(game, prov.id, pick, 'buildHouse1');
    return;
  }

  // Upgrade house portfolio
  for (const rank of [2, 3, 4] as HouseRank[]) {
    const has = houses.some(
      (h) => houseRankFromKind(game.cells[h].building!) === rank,
    );
    if (!has && prov.money >= HOUSE_COST[rank] + 20 && farms >= rank) {
      place(game, prov.id, pick, `buildHouse${rank}` as const);
      return;
    }
  }

  if (threatened && prov.money >= TOWER_COST && Math.random() < 0.45) {
    const cost = prov.money >= STRONG_TOWER_COST && Math.random() < 0.3
      ? 'buildStrongTower'
      : 'buildTower';
    place(game, prov.id, pick, cost);
    return;
  }

  if (net < 6 || farms < prov.hexes.length / 3) {
    const cost = farmCost(game.cells, prov);
    if (prov.money >= cost) {
      place(game, prov.id, pick, 'buildFarm');
      return;
    }
  }

  // Extra house1 if rich
  if (prov.money >= HOUSE_COST[1] + 30 && houses.length < 2) {
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
  // Select a hex in province first
  game.ui = { selectedKey: prov.hexes[0], mode: 'none', hoverKey: null };
  game.setBuildMode(mode);
  game.selectHex(hexKey);
}
