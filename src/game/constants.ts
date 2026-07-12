import type { BuildingKind, HouseRank, UnitRank } from './types';

/** Classic Antiyoy-style economy numbers. */
export const UNIT_COST: Record<UnitRank, number> = {
  1: 10,
  2: 20,
  3: 30,
  4: 40,
};

export const UNIT_UPKEEP: Record<UnitRank, number> = {
  1: 2,
  2: 6,
  3: 18,
  4: 54,
};

export const FARM_BASE_COST = 12;
export const FARM_COST_PER_EXISTING = 2;
export const FARM_INCOME = 4;

export const TOWER_COST = 15;
export const STRONG_TOWER_COST = 35;

/** Extra barracks houses — cost scales with rank. */
export const HOUSE_COST: Record<HouseRank, number> = {
  1: 25,
  2: 50,
  3: 90,
  4: 150,
};

/** Turns until summoned unit appears near the house. */
export const HOUSE_TRAIN_TURNS: Record<HouseRank, number> = {
  1: 1,
  2: 2,
  3: 3,
  4: 4,
};

export const BUILDING_PROTECTION: Record<BuildingKind, number> = {
  castle: 1,
  farm: 0,
  tower: 2,
  strongTower: 3,
  house1: 1,
  house2: 1,
  house3: 1,
  house4: 1,
};

export const BUILDING_INCOME_MOD: Record<BuildingKind, number> = {
  castle: 0,
  farm: FARM_INCOME,
  tower: -1,
  strongTower: -6,
  house1: 0,
  house2: 0,
  house3: 0,
  house4: 0,
};

export const PLAYER_COLORS = [
  '#2f9e44',
  '#1971c2',
  '#e03131',
  '#f08c00',
  '#9c36b5',
  '#0c8599',
  '#e64980',
  '#5c7cfa',
];

export const STARTING_MONEY = 10;
export const INCOME_PER_HEX = 1;

export function houseKind(rank: HouseRank): BuildingKind {
  return (`house${rank}` as BuildingKind);
}

export function houseRankFromKind(kind: BuildingKind): HouseRank | null {
  if (kind === 'house1') return 1;
  if (kind === 'house2') return 2;
  if (kind === 'house3') return 3;
  if (kind === 'house4') return 4;
  return null;
}

export function isHouseBuilding(kind: BuildingKind | null): kind is BuildingKind {
  return kind !== null && houseRankFromKind(kind) !== null;
}
