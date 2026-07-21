import type { BuildingKind, HouseRank, PlayerId, UnitRank } from './types';

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

export const UNIT_LABEL: Record<UnitRank, string> = {
  1: 'Ополченец',
  2: 'Солдат',
  3: 'Спецназ',
  4: 'Танк',
};

/** Recruitment buildings by rank. */
export const RECRUIT_LABEL: Record<HouseRank, string> = {
  1: 'Домик',
  2: 'Казарма',
  3: 'Военный штаб',
  4: 'Военный завод',
};

/** Max number of figurines drawn for a stack (× can be higher). */
export const UNIT_FIGURE_DRAW_MAX = 5;

/** @deprecated use unit.count; kept for menu copy compatibility */
export const UNIT_FIGURE_COUNT: Record<UnitRank, number> = {
  1: 1,
  2: 1,
  3: 1,
  4: 1,
};

export const FARM_BASE_COST = 12;
export const FARM_COST_PER_EXISTING = 2;
export const FARM_INCOME = 4;
/** Extra coins per farm each turn for Expert AI only. */
export const EXPERT_AI_FARM_BONUS = 2;

export const TOWER_COST = 15;
export const STRONG_TOWER_COST = 35;

/** Defense building display names (UI / messages). */
export const DEFENSE_LABEL = {
  tower: 'Огневая точка',
  strongTower: 'Оборонительная линия',
} as const;

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

export const DEFAULT_NATION_NAMES = [
  'Северная Республика',
  'Восточный Союз',
  'Южная Федерация',
  'Западное Княжество',
  'Центральный Альянс',
  'Приморская Держава',
  'Горный Кантон',
  'Степная Империя',
];

export const MAP_SIZE_PRESETS = [
  { id: 'small', label: 'Маленькая', radius: 6 },
  { id: 'medium', label: 'Средняя', radius: 9 },
  { id: 'large', label: 'Большая', radius: 12 },
  { id: 'huge', label: 'Огромная', radius: 15 },
  { id: 'pregiant', label: 'Предгигантская', radius: 30 },
  { id: 'giant', label: 'Гигантская', radius: 45 },
] as const;

export type MapSizeId = (typeof MAP_SIZE_PRESETS)[number]['id'];

export const AI_DIFFICULTY_PRESETS = [
  { id: 'easy', label: 'Лёгкий', hint: 'Ошибки, медленное развитие' },
  { id: 'normal', label: 'Обычный', hint: 'Домики, набор, давление' },
  { id: 'hard', label: 'Сложный', hint: 'Агрессия и экономика' },
  {
    id: 'expert',
    label: 'Эксперт',
    hint: 'Стратегический ИИ: фазы, фокус цели, поиск ходов; фермы +2🪙',
  },
] as const;

export type AiDifficultyId = (typeof AI_DIFFICULTY_PRESETS)[number]['id'];

export const STARTING_MONEY = 10;
export const INCOME_PER_HEX = 1;

/** Default share of land hexes with trees at map generation (0–100). */
export const DEFAULT_FOREST_DENSITY = 10;
export const FOREST_DENSITY_MIN = 0;
export const FOREST_DENSITY_MAX = 100;

export function clampForestDensity(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FOREST_DENSITY;
  return Math.max(FOREST_DENSITY_MIN, Math.min(FOREST_DENSITY_MAX, Math.round(value)));
}

/**
 * Forest spread speed (0–100). At 100 matches classic Antiyoy-like rates
 * (~12% / ~35% palm per adjacent empty hex each full turn).
 */
export const DEFAULT_FOREST_SPREAD = 100;
export const FOREST_SPREAD_MIN = 0;
export const FOREST_SPREAD_MAX = 100;
export const FOREST_SPREAD_BASE_CHANCE = 0.12;
export const FOREST_SPREAD_PALM_CHANCE = 0.35;

export function clampForestSpread(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FOREST_SPREAD;
  return Math.max(FOREST_SPREAD_MIN, Math.min(FOREST_SPREAD_MAX, Math.round(value)));
}

export function houseKind(rank: HouseRank): BuildingKind {
  return `house${rank}` as BuildingKind;
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

export function defaultPlayerSetup(index: number, isHuman: boolean): {
  name: string;
  color: string;
  isHuman: boolean;
  teamId: number;
  aiDifficulty?: AiDifficultyId;
} {
  return {
    name: DEFAULT_NATION_NAMES[index % DEFAULT_NATION_NAMES.length],
    color: PLAYER_COLORS[index % PLAYER_COLORS.length],
    isHuman,
    teamId: index + 1,
  };
}

export function mapRadiusFromSize(id: MapSizeId): number {
  return MAP_SIZE_PRESETS.find((p) => p.id === id)?.radius ?? 9;
}

export type { PlayerId };
