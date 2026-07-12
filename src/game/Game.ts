import {
  HOUSE_COST,
  HOUSE_TRAIN_TURNS,
  STRONG_TOWER_COST,
  TOWER_COST,
  UNIT_COST,
  houseKind,
  houseRankFromKind,
  isHouseBuilding,
} from './constants';
import {
  adjacentEmptyOwned,
  applyIncomeAndStarve,
  canCapture,
  canMoveOntoFriendly,
  defenseStrength,
  farmCost,
  netIncome,
  provinceOfHex,
  provincesOfPlayer,
  rebuildProvinces,
  resetMovedFlags,
  spreadTrees,
} from './economy';
import { hexDistance, hexNeighbors } from './hex';
import { createRng, generateMap } from './mapgen';
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
  private undoStack: GameSnapshot[] = [];

  constructor(config: GameConfig) {
    this.config = config;
    this.rng = createRng(config.seed + 99);
    const { cells, players } = generateMap(config);
    this.cells = cells;
    this.players = players;
    this.currentPlayerId = 1;
    this.provinces = rebuildProvinces(this.cells, [], this.nextProvinceId);
    this.message = 'Ваш ход. Стройте домики, чтобы вызывать юнитов.';
  }

  snapshot(): GameSnapshot {
    return {
      cells: structuredClone(this.cells),
      provinces: structuredClone(this.provinces),
      players: structuredClone(this.players),
      currentPlayerId: this.currentPlayerId,
      turn: this.turn,
      winnerId: this.winnerId,
      nextUnitId: this.nextUnitId,
      nextProvinceId: this.nextProvinceId.value,
      message: this.message,
    };
  }

  pushUndo(): void {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 40) this.undoStack.shift();
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.restore(prev);
    this.message = 'Ход отменён.';
    this.clearSelection();
    return true;
  }

  restore(s: GameSnapshot): void {
    this.cells = s.cells;
    this.provinces = s.provinces;
    this.players = s.players;
    this.currentPlayerId = s.currentPlayerId;
    this.turn = s.turn;
    this.winnerId = s.winnerId;
    this.nextUnitId = s.nextUnitId;
    this.nextProvinceId.value = s.nextProvinceId;
    this.message = s.message;
  }

  clearSelection(): void {
    this.ui = { selectedKey: null, mode: 'none', hoverKey: this.ui.hoverKey };
  }

  currentPlayer() {
    return this.players.find((p) => p.id === this.currentPlayerId)!;
  }

  getProvince(key: string): Province | undefined {
    return provinceOfHex(this.provinces, key);
  }

  selectedProvince(): Province | undefined {
    if (!this.ui.selectedKey) return undefined;
    return this.getProvince(this.ui.selectedKey);
  }

  private refreshProvinces(): void {
    this.provinces = rebuildProvinces(this.cells, this.provinces, this.nextProvinceId);
  }

  private checkWinner(): void {
    const aliveOwners = new Set(
      this.provinces.map((p) => p.owner).filter((o) => o !== 0),
    );
    for (const p of this.players) {
      p.alive = aliveOwners.has(p.id);
    }
    if (aliveOwners.size === 1) {
      this.winnerId = [...aliveOwners][0];
      const winner = this.players.find((p) => p.id === this.winnerId);
      this.message = `${winner?.name ?? 'Игрок'} побеждает!`;
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

    // Select house for training
    if (
      cell.owner === this.currentPlayerId &&
      isHouseBuilding(cell.building)
    ) {
      this.ui = { selectedKey: key, mode: 'house', hoverKey: this.ui.hoverKey };
      const rank = houseRankFromKind(cell.building!)!;
      if (cell.training) {
        this.message = `Домик ${rank}: обучение юнита, осталось ходов: ${cell.training.turnsLeft}.`;
      } else {
        this.message = `Домик ${rank}: можно вызвать юнита ранга ${rank}.`;
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
      buildHouse1: 'домик I',
      buildHouse2: 'домик II',
      buildHouse3: 'домик III',
      buildHouse4: 'домик IV',
    };
    this.message = `Выберите клетку для постройки: ${labels[mode] ?? ''}.`;
  }

  private tryBuild(key: string, mode: SelectionMode): void {
    const cell = this.cells[key];
    const prov = this.getProvince(key);
    if (!cell || !prov || prov.owner !== this.currentPlayerId) {
      this.message = 'Строить можно только в своей провинции.';
      return;
    }
    if (cell.unit || cell.tree || cell.building) {
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
    cell.building = building;
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
      this.message = 'Этот домик уже обучает юнита.';
      return;
    }

    const cost = UNIT_COST[rank];
    if (prov.money < cost) {
      this.message = `Нужно ${cost}🪙 для вызова юнита ранга ${rank}.`;
      return;
    }

    this.pushUndo();
    prov.money -= cost;
    cell.training = {
      rank,
      turnsLeft: HOUSE_TRAIN_TURNS[rank],
    };
    this.message = `Вызов юнита ${rank}: появится через ${HOUSE_TRAIN_TURNS[rank]} ход(а) возле домика.`;
  }

  private tryMoveUnit(fromKey: string, toKey: string): void {
    const from = this.cells[fromKey];
    const to = this.cells[toKey];
    if (!from?.unit || from.unit.moved) return;
    if (!to) return;

    const unit = from.unit;
    if (unit.owner !== this.currentPlayerId) return;

    // Must be adjacent
    if (hexDistance(from, to) !== 1) {
      this.message = 'Юнит ходит только на соседнюю клетку.';
      return;
    }

    // Same province move / merge / cut tree
    if (to.owner === unit.owner) {
      if (to.unit && unit.rank + to.unit.rank > 4) {
        this.message = 'Нельзя объединить — ранг выше 4.';
        return;
      }
      if (to.building === 'castle' && to.unit) {
        this.message = 'Клетка занята.';
        return;
      }
      if (!canMoveOntoFriendly(this.cells, unit, to.q, to.r) && !to.tree) {
        this.message = 'Нельзя сюда ходить.';
        return;
      }

      this.pushUndo();
      if (to.tree) {
        to.tree = false;
        to.palm = false;
        // cutting tree spends the move; unit stays if target has unit? Classic: unit moves onto tree hex and removes tree
        if (to.unit) {
          // merge after cut? rare — treat as merge
          const newRank = (unit.rank + to.unit.rank) as UnitRank;
          to.unit = {
            id: this.nextUnitId++,
            owner: unit.owner,
            rank: newRank,
            moved: true,
          };
          from.unit = null;
        } else {
          from.unit = null;
          to.unit = { ...unit, moved: true };
        }
        this.message = 'Дерево срублено.';
      } else if (to.unit) {
        const newRank = (unit.rank + to.unit.rank) as UnitRank;
        to.unit = {
          id: this.nextUnitId++,
          owner: unit.owner,
          rank: newRank,
          moved: true,
        };
        from.unit = null;
        this.message = `Юниты объединены → ранг ${newRank}.`;
      } else {
        from.unit = null;
        to.unit = { ...unit, moved: true };
        this.message = 'Юнит перемещён.';
      }
      this.ui = { selectedKey: toKey, mode: 'none', hoverKey: this.ui.hoverKey };
      return;
    }

    // Capture neutral or enemy
    if (!canCapture(this.cells, unit, to.q, to.r)) {
      const def = defenseStrength(this.cells, to.q, to.r, to.owner);
      this.message = `Слишком сильная защита (${def}). Нужен ранг > ${def}.`;
      return;
    }

    this.pushUndo();
    // Destroy enemy unit/building (except we capture hex)
    to.unit = null;
    if (to.building && to.building !== 'castle') {
      // farms/towers/houses destroyed on capture
      to.building = null;
      to.training = null;
    } else if (to.building === 'castle') {
      to.building = null;
      to.training = null;
    }
    to.tree = false;
    to.palm = false;
    to.owner = unit.owner;
    from.unit = null;
    to.unit = { ...unit, moved: true };

    this.refreshProvinces();
    this.checkWinner();
    this.ui = { selectedKey: toKey, mode: 'none', hoverKey: this.ui.hoverKey };
    this.message = 'Территория захвачена!';
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
        moved: true, // cannot move on spawn turn
      };
      if (owner === this.config.humanPlayerId) {
        this.message = `Юнит ранга ${rank} появился возле домика!`;
      }
    }
  }

  endTurn(): void {
    if (this.winnerId) return;
    this.pushUndo();
    this.clearSelection();

    // Advance to next alive player
    const order = this.players.map((p) => p.id);
    let idx = order.indexOf(this.currentPlayerId);
    let safety = 0;
    do {
      idx = (idx + 1) % order.length;
      safety++;
    } while (!this.players.find((p) => p.id === order[idx])?.alive && safety < 20);

    const aliveIds = this.players.filter((p) => p.alive).map((p) => p.id).sort((a, b) => a - b);
    const prevId = this.currentPlayerId;
    this.currentPlayerId = order[idx];

    if (this.currentPlayerId === aliveIds[0] && prevId !== this.currentPlayerId) {
      this.turn += 1;
      spreadTrees(this.cells, this.rng);
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
    this.checkWinner();

    const player = this.currentPlayer();
    if (player.isHuman) {
      this.message =
        msgs[0] ??
        `Ход ${this.turn}. Ваш ход — стройте домики и вызывайте юнитов.`;
    } else {
      this.message = `Ход ${this.turn}. Ходит ${player.name}…`;
    }
  }

  /** Valid move targets for selected unit. */
  moveTargets(fromKey: string): Set<string> {
    const from = this.cells[fromKey];
    const result = new Set<string>();
    if (!from?.unit || from.unit.moved) return result;
    const unit = from.unit;
    for (const n of hexNeighbors(from.q, from.r)) {
      const nk = cellKey(n.q, n.r);
      const to = this.cells[nk];
      if (!to) continue;
      if (to.owner === unit.owner) {
        if (to.tree || !to.unit || unit.rank + to.unit.rank <= 4) result.add(nk);
      } else if (canCapture(this.cells, unit, to.q, to.r)) {
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
      if (!c.unit && !c.tree && !c.building) result.add(key);
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
