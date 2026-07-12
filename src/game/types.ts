/** Core types for the Antiyoy-style hex strategy game. */

export type PlayerId = number; // 0 = neutral, 1..N = players
export type UnitRank = 1 | 2 | 3 | 4;
export type HouseRank = 1 | 2 | 3 | 4;

export type BuildingKind =
  | 'castle'
  | 'farm'
  | 'tower'
  | 'strongTower'
  | 'house1'
  | 'house2'
  | 'house3'
  | 'house4';

export interface Axial {
  q: number;
  r: number;
}

export interface Unit {
  id: number;
  owner: PlayerId;
  rank: UnitRank;
  moved: boolean;
}

export interface TrainingQueue {
  rank: UnitRank;
  turnsLeft: number;
}

export interface HexCell {
  q: number;
  r: number;
  owner: PlayerId;
  unit: Unit | null;
  building: BuildingKind | null;
  tree: boolean;
  palm: boolean;
  /** Active training at a house building on this hex. */
  training: TrainingQueue | null;
}

export interface Province {
  id: number;
  owner: PlayerId;
  hexes: string[]; // cell keys "q,r"
  capitalKey: string;
  money: number;
}

export interface Player {
  id: PlayerId;
  name: string;
  color: string;
  isHuman: boolean;
  alive: boolean;
}

/** Setup entry from the start menu. */
export interface PlayerSetup {
  name: string;
  color: string;
  isHuman: boolean;
}

export type SelectionMode =
  | 'none'
  | 'unit'
  | 'buildFarm'
  | 'buildTower'
  | 'buildStrongTower'
  | 'buildHouse1'
  | 'buildHouse2'
  | 'buildHouse3'
  | 'buildHouse4'
  | 'house';

export interface GameConfig {
  mapRadius: number;
  playerCount: number;
  /** @deprecated use players[].isHuman — kept for older call sites */
  humanPlayerId?: PlayerId;
  seed: number;
  players: PlayerSetup[];
}

export interface GameSnapshot {
  cells: Record<string, HexCell>;
  provinces: Province[];
  players: Player[];
  currentPlayerId: PlayerId;
  turn: number;
  winnerId: PlayerId | null;
  nextUnitId: number;
  nextProvinceId: number;
  message: string;
}

export function cellKey(q: number, r: number): string {
  return `${q},${r}`;
}

export function parseKey(key: string): Axial {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
}
