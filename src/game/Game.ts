import {
  HOUSE_COST,
  HOUSE_TRAIN_TURNS,
  RECRUIT_LABEL,
  STRONG_TOWER_COST,
  TOWER_COST,
  UNIT_COST,
  UNIT_LABEL,
  houseKind,
  houseRankFromKind,
  isHouseBuilding,
} from './constants';
import {
  adjacentEmptyOwned,
  applyIncomeAndStarve,
  canCapture,
  defenseStrength,
  farmCost,
  netIncome,
  provinceOfHex,
  provincesOfPlayer,
  rebuildProvinces,
  resetMovedFlags,
  spreadTrees,
} from './economy';
import { cloneCells, clonePlayers, cloneProvinces } from './clone';
import { hexDistance, hexNeighbors } from './hex';import { createRng, generateMap } from './mapgen';
import {
  cellKey,
  type BuildingKind,
  type GameConfig,
  type GameSnapshot,
  type HexCell,
  type HouseRank,
  type PlayerId,
  type Province,
  type SelectionMode,
  type UnitRank,
} from './types';

export interface UiState {
  selectedKey: string | null;
  mode: SelectionMode;
  hoverKey: string | null;
}

export class Game {
  cells: Record<string, HexCell>;
  provinces: Province[] = [];
  players;
  currentPlayerId: PlayerId;
  turn = 1;
  winnerId: PlayerId | null = null;
  nextUnitId = 1;
  nextProvinceId = { value: 1 };
  message = '';
  ui: UiState = { selectedKey: null, mode: 'none', hoverKey: null };
  private rng: () => number;
  readonly config: GameConfig;
  private turnCheckpoint: GameSnapshot | null = null;
  private batchDepth = 0;
  private provincesDirty = false;
  /** O(1) hex → province lookup; rebuilt with provinces. */
  private provinceByHex = new Map<string, Province>();
  /** Bumped when terrain/buildings/owners change (not on unit-only moves). */
  terrainRevision = 0;
  /** Bumped when units move / spawn (overlay only). */
  unitsRevision = 0;

  bumpTerrain(): void {
    this.terrainRevision += 1;
  }

  bumpUnits(): void {
    this.unitsRevision += 1;
  }

  constructor(config: GameConfig) {
    this.config = config;
    this.rng = createRng(config.seed + 99);
    const { cells, players } = generateMap(config);
    this.cells = cells;
    this.players = players;
    this.currentPlayerId = 1;
    this.provinces = rebuildProvinces(this.cells, [], this.nextProvinceId);
    this.reindexProvinces();
    this.message = 'Ваш ход. Стройте домики, чтобы вызывать юнитов.';
  }

  snapshot(): GameSnapshot {
    return {
      cells: cloneCells(this.cells),
      provinces: cloneProvinces(this.provinces),
      players: clonePlayers(this.players),
      currentPlayerId: this.currentPlayerId,
      turn: this.turn,
      winnerId: this.winnerId,
      nextUnitId: this.nextUnitId,
      nextProvinceId: this.nextProvinceId.value,
      message: this.message,
    };
  }

  pushUndo(): void {
    // Per-action deep clones freeze the UI. Undo restores the turn checkpoint instead.
  }

  /** Snapshot at the start of a human turn for one-click undo of the whole turn. */
  saveTurnCheckpoint(): void {
    if (!this.currentPlayer()?.isHuman) {
      this.turnCheckpoint = null;
      return;
    }
    this.turnCheckpoint = this.snapshot();
  }

  undo(): boolean {
    if (!this.turnCheckpoint) {
      this.message = 'Нечего отменять.';
      return false;
    }
    if (!this.currentPlayer()?.isHuman) return false;
    // Restore from an independent clone so the turn checkpoint stays pristine
    // and can be reused until the next human turn starts.
    this.restore(this.turnCheckpoint);
    this.message = 'Ход отменён (к началу вашего хода).';
    this.clearSelection();
    return true;
  }

  restore(s: GameSnapshot): void {
    this.cells = cloneCells(s.cells);
    this.provinces = cloneProvinces(s.provinces);
    this.players = clonePlayers(s.players);
    this.currentPlayerId = s.currentPlayerId;
    this.turn = s.turn;
    this.winnerId = s.winnerId;
    this.nextUnitId = s.nextUnitId;
    this.nextProvinceId.value = s.nextProvinceId;
    this.message = s.message;
    this.reindexProvinces();
    this.bumpTerrain();
    this.bumpUnits();
  }

  private reindexProvinces(): void {
    this.provinceByHex.clear();
    for (const p of this.provinces) {
      for (const h of p.hexes) this.provinceByHex.set(h, p);
    }
  }

  clearSelection(): void {
    this.ui = { selectedKey: null, mode: 'none', hoverKey: this.ui.hoverKey };
  }

  currentPlayer() {
    return this.players.find((p) => p.id === this.currentPlayerId)!;
  }

  getProvince(key: string): Province | undefined {
    return this.provinceByHex.get(key) ?? provinceOfHex(this.provinces, key);
  }

  selectedProvince(): Province | undefined {
    if (!this.ui.selectedKey) return undefined;
    return this.getProvince(this.ui.selectedKey);
  }

  private refreshProvinces(): void {
    if (this.batchDepth > 0) {
      this.provincesDirty = true;
      return;
    }
    this.provinces = rebuildProvinces(this.cells, this.provinces, this.nextProvinceId);
    this.reindexProvinces();
    this.bumpTerrain();
  }

  /** Batch AI/actions: defer expensive province rebuilds. */
  beginBatch(): void {
    this.batchDepth += 1;
  }

  endBatch(): void {
    this.batchDepth = Math.max(0, this.batchDepth - 1);
    if (this.batchDepth === 0 && this.provincesDirty) {
      this.provincesDirty = false;
      this.provinces = rebuildProvinces(this.cells, this.provinces, this.nextProvinceId);
      this.reindexProvinces();
      this.bumpTerrain();
      this.checkWinner();
    }
  }

  private checkWinner(): void {
    const aliveOwners = new Set(
      this.provinces.map((p) => p.owner).filter((o) => o !== 0),
    );
    for (const p of this.players) {
      p.alive = aliveOwners.has(p.id);
    }
    if (aliveOwners.size <= 1) {
      this.winnerId =
        aliveOwners.size === 1 ? [...aliveOwners][0]! : this.currentPlayerId;
      const winner = this.players.find((p) => p.id === this.winnerId);
      this.message =
        aliveOwners.size === 1
          ? `${winner?.name ?? 'Игрок'} побеждает!`
          : 'Игра окончена.';
    }
  }

  selectHex(key: string | null): void {
    if (this.winnerId || !this.currentPlayer().isHuman) return;
    if (!key || !this.cells[key]) {
      this.clearSelection();
      return;
    }

    const cell = this.cells[key];
    const mode = this.ui.mode;

    if (
      mode === 'buildFarm' ||
      mode === 'buildTower' ||
      mode === 'buildStrongTower' ||
      mode === 'buildHouse1' ||
      mode === 'buildHouse2' ||
      mode === 'buildHouse3' ||
      mode === 'buildHouse4'
    ) {
      this.tryBuild(key, mode);
      return;
    }

    if (mode === 'unit' && this.ui.selectedKey) {
      this.tryMoveUnit(this.ui.selectedKey, key);
      return;
    }

    // Select own unit
    if (cell.unit && cell.unit.owner === this.currentPlayerId && !cell.unit.moved) {
      this.ui = { selectedKey: key, mode: 'unit', hoverKey: this.ui.hoverKey };
      this.message = `Юнит ранга ${cell.unit.rank}. Выберите клетку для хода.`;
      return;
    }

    // Select recruitment building — opens summon UI
    if (
      cell.owner === this.currentPlayerId &&
      isHouseBuilding(cell.building)
    ) {
      this.ui = { selectedKey: key, mode: 'house', hoverKey: this.ui.hoverKey };
      const rank = houseRankFromKind(cell.building!)!;
      const name = RECRUIT_LABEL[rank];
      if (cell.training) {
        this.message = `${name}: обучение, осталось ходов: ${cell.training.turnsLeft}.`;
      } else {
        this.message = `${name}: можно вызвать ${UNIT_LABEL[rank]}.`;
      }
      return;
    }

    // Select own hex / province
    if (cell.owner === this.currentPlayerId) {
      this.ui = { selectedKey: key, mode: 'none', hoverKey: this.ui.hoverKey };
      const prov = this.getProvince(key);
      if (prov) {
        const net = netIncome(this.cells, prov);
        this.message = `Провинция: ${prov.money}🪙 (доход ${net >= 0 ? '+' : ''}${net}/ход)`;
      }
      return;
    }

    this.clearSelection();
  }

  setBuildMode(mode: SelectionMode): void {
    if (!this.currentPlayer().isHuman || this.winnerId) return;
    const prov = this.selectedProvince();
    if (!prov || prov.owner !== this.currentPlayerId) {
      this.message = 'Сначала выберите свою провинцию.';
      return;
    }
    this.ui.mode = mode;
    const labels: Partial<Record<SelectionMode, string>> = {
      buildFarm: 'ферму',
      buildTower: 'башню',
      buildStrongTower: 'крепкую башню',
      buildHouse1: 'домик',
      buildHouse2: 'казарму',
      buildHouse3: 'военный штаб',
      buildHouse4: 'военный завод',
    };
    this.message = `Выберите клетку для постройки: ${labels[mode] ?? ''}.`;
  }

  /** Direct build for AI / scripts (bypasses human UI gates). */
  buildAt(key: string, mode: SelectionMode): boolean {
    if (this.winnerId) return false;
    const before = this.cells[key]?.building ?? null;
    this.tryBuild(key, mode);
    return (this.cells[key]?.building ?? null) !== before && this.cells[key]?.building !== null;
  }

  /** Direct unit move for AI. */
  moveUnitTo(fromKey: string, toKey: string): void {
    if (this.winnerId) return;
    this.tryMoveUnit(fromKey, toKey);
  }

  /** Direct summon for AI. */
  summonAt(houseKey: string): boolean {
    if (this.winnerId) return false;
    const cell = this.cells[houseKey];
    if (!cell || !isHouseBuilding(cell.building) || cell.training) return false;
    this.ui = { selectedKey: houseKey, mode: 'house', hoverKey: null };
    const had = cell.training;
    this.summonFromHouse();
    return cell.training !== had && cell.training !== null;
  }

  private tryBuild(key: string, mode: SelectionMode): void {
    const cell = this.cells[key];
    const prov = this.getProvince(key);
    if (!cell || !prov || prov.owner !== this.currentPlayerId) {
      this.message = 'Строить можно только в своей провинции.';
      return;
    }
    if (cell.unit || cell.building) {
      this.message = 'Клетка занята.';
      return;
    }

    let cost = 0;
    let building: BuildingKind | null = null;

    switch (mode) {
      case 'buildFarm':
        cost = farmCost(this.cells, prov);
        building = 'farm';
        break;
      case 'buildTower':
        cost = TOWER_COST;
        building = 'tower';
        break;
      case 'buildStrongTower':
        cost = STRONG_TOWER_COST;
        building = 'strongTower';
        break;
      case 'buildHouse1':
      case 'buildHouse2':
      case 'buildHouse3':
      case 'buildHouse4': {
        const rank = Number(mode.replace('buildHouse', '')) as HouseRank;
        cost = HOUSE_COST[rank];
        building = houseKind(rank);
        break;
      }
      default:
        return;
    }

    if (prov.money < cost) {
      this.message = `Недостаточно монет (нужно ${cost}).`;
      return;
    }

    this.pushUndo();
    prov.money -= cost;
    // Building on a tree clears the forest
    cell.tree = false;
    cell.palm = false;
    cell.building = building;
    this.bumpTerrain();
    this.ui.mode = 'none';
    this.ui.selectedKey = key;
    this.message = `Построено: ${building} (−${cost}🪙).`;
  }

  /** Summon unit from selected house — starts training queue. */
  summonFromHouse(): void {
    if (this.ui.mode !== 'house' || !this.ui.selectedKey) return;
    const key = this.ui.selectedKey;
    const cell = this.cells[key];
    const prov = this.getProvince(key);
    if (!cell || !prov || !isHouseBuilding(cell.building)) return;

    const rank = houseRankFromKind(cell.building!) as UnitRank;
    if (cell.training) {
      this.message = `${RECRUIT_LABEL[rank]} уже обучает юнита.`;
      return;
    }

    const cost = UNIT_COST[rank];
    if (prov.money < cost) {
      this.message = `Нужно ${cost}🪙 для вызова: ${UNIT_LABEL[rank]}.`;
      return;
    }

    this.pushUndo();
    prov.money -= cost;
    cell.training = {
      rank,
      turnsLeft: HOUSE_TRAIN_TURNS[rank],
    };
    this.message = `Вызов из «${RECRUIT_LABEL[rank]}»: ${UNIT_LABEL[rank]} — через ${HOUSE_TRAIN_TURNS[rank]} ход(а).`;
  }

  private tryMoveUnit(fromKey: string, toKey: string): void {
    const from = this.cells[fromKey];
    const to = this.cells[toKey];
    if (!from?.unit || from.unit.moved) return;
    if (!to) return;

    const unit = from.unit;
    if (unit.owner !== this.currentPlayerId) return;

    const targets = this.moveTargets(fromKey);
    if (!targets.has(toKey)) {
      this.message = 'Сюда ходить нельзя.';
      return;
    }

    // Friendly territory: move up to 2 hexes, or merge same-rank stacks
    if (to.owner === unit.owner) {
      if (to.unit) {
        if (to.unit.rank !== unit.rank) {
          this.message = 'Можно объединять только юнитов одного ранга.';
          return;
        }
        this.pushUndo();
        const merged = (to.unit.count ?? 1) + (unit.count ?? 1);
        to.unit = {
          ...to.unit,
          count: merged,
          moved: true,
        };
        from.unit = null;
        this.bumpUnits();
        this.ui = { selectedKey: toKey, mode: 'none', hoverKey: this.ui.hoverKey };
        this.message = `Объединено: ${UNIT_LABEL[unit.rank]} ×${merged}.`;
        return;
      }

      this.pushUndo();
      if (to.tree) {
        to.tree = false;
        to.palm = false;
        this.bumpTerrain();
        this.message = 'Дерево срублено.';
      } else {
        this.message = 'Юнит перемещён.';
      }
      from.unit = null;
      to.unit = { ...unit, count: unit.count ?? 1, moved: true };
      this.bumpUnits();
      this.ui = { selectedKey: toKey, mode: 'none', hoverKey: this.ui.hoverKey };
      return;
    }

    // Capture: only adjacent (enforced by moveTargets)
    if (hexDistance(from, to) !== 1) {
      this.message = 'Атаковать можно только соседнюю клетку.';
      return;
    }

    if (!canCapture(this.cells, unit, to.q, to.r)) {
      if (to.unit && to.unit.rank === unit.rank) {
        this.message = `Нужен больший отряд (у вас ×${unit.count ?? 1}, у врага ×${to.unit.count ?? 1}).`;
      } else {
        const def = defenseStrength(this.cells, to.q, to.r, to.owner);
        this.message = `Слишком сильная защита (${def}). Нужен ранг > ${def}.`;
      }
      return;
    }

    this.pushUndo();
    const sameRankDuel = !!(to.unit && to.unit.rank === unit.rank);
    let remaining = unit.count ?? 1;
    if (sameRankDuel && to.unit) {
      remaining = remaining - (to.unit.count ?? 1);
      if (remaining < 1) remaining = 1; // safety; should not happen if canCapture
    }

    to.unit = null;
    if (to.building) {
      to.building = null;
      to.training = null;
    }
    to.tree = false;
    to.palm = false;
    to.owner = unit.owner;
    from.unit = null;
    to.unit = { ...unit, count: remaining, moved: true };

    this.refreshProvinces();
    this.bumpTerrain();
    this.bumpUnits();
    if (this.batchDepth === 0) this.checkWinner();
    this.ui = { selectedKey: toKey, mode: 'none', hoverKey: this.ui.hoverKey };
    this.message = sameRankDuel
      ? `Победа в бою отрядов: осталось ×${remaining}.`
      : 'Территория захвачена!';
  }

  /** Process house training at the start of a player's turn. */
  processTraining(owner: PlayerId): void {
    for (const cell of Object.values(this.cells)) {
      if (cell.owner !== owner || !cell.training) continue;
      cell.training.turnsLeft -= 1;
      if (cell.training.turnsLeft > 0) continue;

      const rank = cell.training.rank;
      cell.training = null;
      const spots = adjacentEmptyOwned(this.cells, cell.q, cell.r, owner);
      if (spots.length === 0) {
        // Refund? Or wait — refund unit cost to province
        const prov = this.getProvince(cellKey(cell.q, cell.r));
        if (prov) {
          prov.money += UNIT_COST[rank];
          this.message = `Нет места для юнита ${rank} у домика — монеты возвращены.`;
        }
        continue;
      }
      const spawnKey = spots[Math.floor(this.rng() * spots.length)];
      this.cells[spawnKey].unit = {
        id: this.nextUnitId++,
        owner,
        rank,
        count: 1,
        moved: true, // cannot move on spawn turn
      };
      this.bumpUnits();
      if (this.players.find((p) => p.id === owner)?.isHuman) {
        this.message = `${UNIT_LABEL[rank]} появились возле «${RECRUIT_LABEL[rank]}»!`;
      }
    }
  }

  endTurn(): void {
    if (this.winnerId) return;
    this.pushUndo();
    this.clearSelection();

    const order = this.players.map((p) => p.id);
    let idx = order.indexOf(this.currentPlayerId);
    let safety = 0;
    do {
      idx = (idx + 1) % order.length;
      safety++;
    } while (!this.players.find((p) => p.id === order[idx])?.alive && safety < order.length + 2);

    const aliveIds = this.players
      .filter((p) => p.alive)
      .map((p) => p.id)
      .sort((a, b) => a - b);
    const prevId = this.currentPlayerId;
    this.currentPlayerId = order[idx];

    if (!this.currentPlayer()?.alive || aliveIds.length === 0) {
      this.checkWinner();
      return;
    }

    if (this.currentPlayerId === aliveIds[0] && prevId !== this.currentPlayerId) {
      this.turn += 1;
      spreadTrees(this.cells, this.rng);
      this.bumpTerrain();
    }

    this.beginPlayerTurn(this.currentPlayerId);
  }

  beginPlayerTurn(playerId: PlayerId): void {
    this.currentPlayerId = playerId;
    resetMovedFlags(this.cells, playerId);
    this.processTraining(playerId);

    // Income for all provinces of this player
    const mine = provincesOfPlayer(this.provinces, playerId);
    const msgs = applyIncomeAndStarve(
      this.cells,
      mine,
    );
    this.refreshProvinces();
    this.bumpUnits();
    this.checkWinner();

    const player = this.currentPlayer();
    if (player.isHuman) {
      this.saveTurnCheckpoint();
      this.message =
        msgs[0] ??
        `Ход ${this.turn}. Ваш ход — стройте домики и вызывайте юнитов.`;
    } else {
      this.turnCheckpoint = null;
      this.message = `Ход ${this.turn}. Ходит ${player.name}…`;
    }
  }

  /** Valid move targets for selected unit. */
  moveTargets(fromKey: string): Set<string> {
    const from = this.cells[fromKey];
    const result = new Set<string>();
    if (!from?.unit || from.unit.moved) return result;
    const unit = from.unit;

    // Own territory: BFS up to 2 steps through empty owned hexes; can land on same-rank stack
    const queue: { key: string; dist: number }[] = [{ key: fromKey, dist: 0 }];
    const seen = new Set<string>([fromKey]);
    while (queue.length) {
      const { key, dist } = queue.shift()!;
      if (dist >= 2) continue;
      const cell = this.cells[key];
      for (const n of hexNeighbors(cell.q, cell.r)) {
        const nk = cellKey(n.q, n.r);
        if (seen.has(nk)) continue;
        const to = this.cells[nk];
        if (!to || to.owner !== unit.owner) continue;
        if (to.unit) {
          if (to.unit.rank === unit.rank) {
            seen.add(nk);
            result.add(nk); // merge target — do not path through
          }
          continue;
        }
        seen.add(nk);
        result.add(nk);
        queue.push({ key: nk, dist: dist + 1 });
      }
    }

    // Attacks / neutral capture: adjacent only
    for (const n of hexNeighbors(from.q, from.r)) {
      const nk = cellKey(n.q, n.r);
      const to = this.cells[nk];
      if (!to) continue;
      if (to.owner !== unit.owner && canCapture(this.cells, unit, to.q, to.r)) {
        result.add(nk);
      }
    }
    return result;
  }

  buildTargets(mode: SelectionMode): Set<string> {
    const result = new Set<string>();
    const prov = this.selectedProvince();
    if (!prov || prov.owner !== this.currentPlayerId) return result;
    for (const key of prov.hexes) {
      const c = this.cells[key];
      // Trees are allowed — building clears them
      if (!c.unit && !c.building) result.add(key);
    }
    void mode;
    return result;
  }

  getHouseTrainInfo(key: string): { rank: HouseRank; turnsLeft: number } | null {
    const cell = this.cells[key];
    if (!cell?.training || !isHouseBuilding(cell.building)) return null;
    return {
      rank: houseRankFromKind(cell.building!)!,
      turnsLeft: cell.training.turnsLeft,
    };
  }
}
