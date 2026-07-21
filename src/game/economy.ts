import {
  BUILDING_INCOME_MOD,
  BUILDING_PROTECTION,
  FOREST_SPREAD_BASE_CHANCE,
  FOREST_SPREAD_PALM_CHANCE,
  INCOME_PER_HEX,
  STARTING_MONEY,
  UNIT_UPKEEP,
  clampForestSpread,
} from './constants';
import { hexNeighbors } from './hex';
import {
  cellKey,
  parseKey,
  type HexCell,
  type PlayerId,
  type Province,
  type Unit,
} from './types';

export function rebuildProvinces(
  cells: Record<string, HexCell>,
  previous: Province[],
  nextProvinceId: { value: number },
): Province[] {
  const visited = new Set<string>();
  const provinces: Province[] = [];
  const prevByCapital = new Map(previous.map((p) => [p.capitalKey, p]));
  const prevMoneyByOwnerHex = new Map<string, number>();

  for (const p of previous) {
    for (const hk of p.hexes) {
      prevMoneyByOwnerHex.set(`${p.owner}:${hk}`, p.money);
    }
  }

  for (const key of Object.keys(cells)) {
    const cell = cells[key];
    if (cell.owner === 0 || visited.has(key)) continue;

    const hexes = floodOwner(cells, key, cell.owner, visited);
    if (hexes.length === 0) continue;

    // Capitals: prefer existing castle in province, else place on first hex
    let capitalKey =
      hexes.find((h) => cells[h].building === 'castle') ??
      hexes.find((h) => prevByCapital.has(h)) ??
      hexes[0];

    // Ensure exactly one castle in province
    for (const h of hexes) {
      if (cells[h].building === 'castle' && h !== capitalKey) {
        cells[h].building = null;
      }
    }
    if (cells[capitalKey].building !== 'castle') {
      // Don't overwrite farm/tower/house unless empty
      if (
        cells[capitalKey].building === null ||
        cells[capitalKey].building === 'farm'
      ) {
        cells[capitalKey].building = 'castle';
      } else {
        const empty = hexes.find((h) => cells[h].building === null && !cells[h].unit);
        capitalKey = empty ?? hexes[0];
        cells[capitalKey].building = 'castle';
      }
    }

    // Inherit money: if province merged/split, take max money from overlapping previous hexes of same owner
    let money = STARTING_MONEY;
    let found = false;
    let maxMoney = 0;
    for (const h of hexes) {
      const m = prevMoneyByOwnerHex.get(`${cell.owner}:${h}`);
      if (m !== undefined) {
        found = true;
        maxMoney = Math.max(maxMoney, m);
      }
    }
    if (found) money = maxMoney;
    else money = STARTING_MONEY;

    // Tiny single-hex provinces with no castle money = 0 until expanded? Keep STARTING for fairness on new splits from capture
    if (hexes.length === 1 && !found) money = 0;

    provinces.push({
      id: nextProvinceId.value++,
      owner: cell.owner,
      hexes,
      capitalKey,
      money,
    });
  }

  return provinces;
}

function floodOwner(
  cells: Record<string, HexCell>,
  start: string,
  owner: PlayerId,
  visited: Set<string>,
): string[] {
  const result: string[] = [];
  const stack = [start];
  while (stack.length) {
    const key = stack.pop()!;
    if (visited.has(key)) continue;
    const cell = cells[key];
    if (!cell || cell.owner !== owner) continue;
    visited.add(key);
    result.push(key);
    for (const n of hexNeighbors(cell.q, cell.r)) {
      const nk = cellKey(n.q, n.r);
      if (!visited.has(nk) && cells[nk]?.owner === owner) stack.push(nk);
    }
  }
  return result;
}

export function provinceOfHex(
  provinces: Province[],
  key: string,
): Province | undefined {
  return provinces.find((p) => p.hexes.includes(key));
}

export function provincesOfPlayer(provinces: Province[], owner: PlayerId): Province[] {
  return provinces.filter((p) => p.owner === owner);
}

export function countFarms(cells: Record<string, HexCell>, province: Province): number {
  return province.hexes.filter((h) => cells[h].building === 'farm').length;
}

export function farmCost(cells: Record<string, HexCell>, province: Province): number {
  return 12 + 2 * countFarms(cells, province);
}

export function calcIncome(
  cells: Record<string, HexCell>,
  province: Province,
  farmBonusPerFarm = 0,
): number {
  let income = 0;
  for (const key of province.hexes) {
    const cell = cells[key];
    if (cell.tree) continue;
    income += INCOME_PER_HEX;
    if (cell.building) {
      income += BUILDING_INCOME_MOD[cell.building];
      if (cell.building === 'farm' && farmBonusPerFarm > 0) {
        income += farmBonusPerFarm;
      }
    }
  }
  return income;
}

export function calcUpkeep(cells: Record<string, HexCell>, province: Province): number {
  let upkeep = 0;
  for (const key of province.hexes) {
    const u = cells[key].unit;
    // Only charge the province for its owner's units (allied guests are charged elsewhere)
    if (u && u.owner === province.owner) upkeep += UNIT_UPKEEP[u.rank];
  }
  return upkeep;
}

/** Upkeep for a player's units standing on foreign (incl. ally) hexes. */
export function calcForeignUnitUpkeep(
  cells: Record<string, HexCell>,
  playerId: PlayerId,
): number {
  let upkeep = 0;
  for (const key in cells) {
    const cell = cells[key];
    const u = cell.unit;
    if (u && u.owner === playerId && cell.owner !== playerId) {
      upkeep += UNIT_UPKEEP[u.rank];
    }
  }
  return upkeep;
}

export function netIncome(
  cells: Record<string, HexCell>,
  province: Province,
  farmBonusPerFarm = 0,
): number {
  return calcIncome(cells, province, farmBonusPerFarm) - calcUpkeep(cells, province);
}

type AllyFn = (a: PlayerId, b: PlayerId) => boolean;

function isFriendlyUnit(
  unitOwner: PlayerId,
  forOwner: PlayerId,
  allies?: AllyFn,
): boolean {
  return unitOwner === forOwner || !!allies?.(forOwner, unitOwner);
}

/** Defense strength of a hex for the current owner (unit on hex + adjacent friendly units + buildings). */
export function defenseStrength(
  cells: Record<string, HexCell>,
  q: number,
  r: number,
  forOwner: PlayerId,
  allies?: AllyFn,
): number {
  const key = cellKey(q, r);
  const cell = cells[key];
  if (!cell || cell.owner !== forOwner) return 0;

  let strength = 0;
  if (cell.unit && isFriendlyUnit(cell.unit.owner, forOwner, allies)) {
    strength = Math.max(strength, cell.unit.rank);
  }
  if (cell.building) {
    strength = Math.max(strength, BUILDING_PROTECTION[cell.building]);
  }

  for (const n of hexNeighbors(q, r)) {
    const nc = cells[cellKey(n.q, n.r)];
    if (!nc || nc.owner !== forOwner) continue;
    if (nc.unit && isFriendlyUnit(nc.unit.owner, forOwner, allies)) {
      strength = Math.max(strength, nc.unit.rank);
    }
    // Towers/castles protect adjacent hexes
    if (nc.building) {
      const prot = BUILDING_PROTECTION[nc.building];
      if (prot > 0) strength = Math.max(strength, prot);
    }
  }
  return strength;
}

/** Defense excluding the unit standing on the hex (buildings + adjacent still count). */
export function defenseStrengthExcludingHexUnit(
  cells: Record<string, HexCell>,
  q: number,
  r: number,
  forOwner: PlayerId,
  allies?: AllyFn,
): number {
  const key = cellKey(q, r);
  const cell = cells[key];
  if (!cell || cell.owner !== forOwner) return 0;

  let strength = 0;
  if (cell.building) {
    strength = Math.max(strength, BUILDING_PROTECTION[cell.building]);
  }

  for (const n of hexNeighbors(q, r)) {
    const nc = cells[cellKey(n.q, n.r)];
    if (!nc || nc.owner !== forOwner) continue;
    if (nc.unit && isFriendlyUnit(nc.unit.owner, forOwner, allies)) {
      strength = Math.max(strength, nc.unit.rank);
    }
    if (nc.building) {
      const prot = BUILDING_PROTECTION[nc.building];
      if (prot > 0) strength = Math.max(strength, prot);
    }
  }
  return strength;
}

/** Can attacker capture target hex? */
export function canCapture(
  cells: Record<string, HexCell>,
  attacker: Unit,
  targetQ: number,
  targetR: number,
  allies?: AllyFn,
): boolean {
  const target = cells[cellKey(targetQ, targetR)];
  if (!target) return false;
  if (target.owner === attacker.owner) return false;
  if (allies?.(attacker.owner, target.owner)) return false;
  // Cannot capture a hex that has an allied unit standing on it
  if (target.unit && allies?.(attacker.owner, target.unit.owner)) return false;

  const atkCount = attacker.count ?? 1;

  // Same-rank unit duel: need higher stack, and still beat buildings/adjacent cover
  if (target.unit && target.unit.rank === attacker.rank) {
    const cover = defenseStrengthExcludingHexUnit(
      cells,
      targetQ,
      targetR,
      target.owner,
      allies,
    );
    if (!(attacker.rank > cover || (attacker.rank === 4 && cover === 4))) return false;
    return atkCount > (target.unit.count ?? 1);
  }

  const defense = defenseStrength(cells, targetQ, targetR, target.owner, allies);
  if (attacker.rank === 4 && defense === 4) return true;
  return attacker.rank > defense;
}

export function canMoveOntoFriendly(
  cells: Record<string, HexCell>,
  unit: Unit,
  targetQ: number,
  targetR: number,
): boolean {
  const target = cells[cellKey(targetQ, targetR)];
  if (!target || target.owner !== unit.owner) return false;
  if (!target.unit) return true;
  // Same-rank stacks may merge
  return target.unit.rank === unit.rank;
}

export function applyIncomeAndStarve(
  cells: Record<string, HexCell>,
  provinces: Province[],
  farmBonusPerFarm = 0,
): string[] {
  const messages: string[] = [];
  for (const p of provinces) {
    const net = netIncome(cells, p, farmBonusPerFarm);
    p.money += net;
    if (p.money < 0) {
      // Starve: kill all units in province, spawn trees
      for (const key of p.hexes) {
        const cell = cells[key];
        if (cell.unit) {
          cell.unit = null;
          cell.tree = true;
        }
      }
      p.money = 0;
      messages.push(`Провинция игрока ${p.owner} разорена — юниты погибли.`);
    }
  }
  return messages;
}

export function spreadTrees(
  cells: Record<string, HexCell>,
  rng: () => number,
  forestSpread = 100,
): void {
  const speed = clampForestSpread(forestSpread) / 100;
  if (speed <= 0) return;

  const toGrow: string[] = [];
  for (const cell of Object.values(cells)) {
    if (!cell.tree) continue;
    for (const n of hexNeighbors(cell.q, cell.r)) {
      const nk = cellKey(n.q, n.r);
      const nc = cells[nk];
      if (!nc || nc.tree || nc.unit || nc.building) continue;
      const chance = (cell.palm ? FOREST_SPREAD_PALM_CHANCE : FOREST_SPREAD_BASE_CHANCE) * speed;
      if (rng() < chance) toGrow.push(nk);
    }
  }
  for (const key of toGrow) {
    cells[key].tree = true;
    if (rng() < 0.2) cells[key].palm = true;
  }
}

export function resetMovedFlags(cells: Record<string, HexCell>, owner: PlayerId): void {
  for (const cell of Object.values(cells)) {
    if (cell.unit && cell.unit.owner === owner) cell.unit.moved = false;
  }
}

export function adjacentEmptyOwned(
  cells: Record<string, HexCell>,
  q: number,
  r: number,
  owner: PlayerId,
): string[] {
  const result: string[] = [];
  // Prefer adjacent, then the house hex itself if empty
  for (const n of hexNeighbors(q, r)) {
    const nk = cellKey(n.q, n.r);
    const nc = cells[nk];
    if (nc && nc.owner === owner && !nc.unit && !nc.tree) result.push(nk);
  }
  const self = cellKey(q, r);
  const sc = cells[self];
  if (sc && sc.owner === owner && !sc.unit && !sc.tree) result.push(self);
  return result;
}

export function listProvinceUnits(cells: Record<string, HexCell>, province: Province): Unit[] {
  const units: Unit[] = [];
  for (const key of province.hexes) {
    const u = cells[key].unit;
    if (u) units.push(u);
  }
  return units;
}

export function hexLabel(key: string): string {
  const { q, r } = parseKey(key);
  return `(${q},${r})`;
}
