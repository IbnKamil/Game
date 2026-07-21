import {
  DEFAULT_FOREST_SPREAD,
  EXPERT_AI_FARM_BONUS,
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
  calcForeignUnitUpkeep,
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
import { hexDistance, hexNeighbors } from './hex';
import { createRng, generateMap } from './mapgen';
import { alliesOf, isAlly, isEnemy } from './teams';
import {
  cellKey,
  type AiDifficulty,
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
    const aliveTeams = new Set(
      [...aliveOwners].map((id) => this.players.find((p) => p.id === id)?.teamId ?? id),
    );
    if (aliveTeams.size <= 1) {
      const winnerPlayerId =
        aliveOwners.size >= 1 ? [...aliveOwners][0]! : this.currentPlayerId;
      this.winnerId = winnerPlayerId;
      const winner = this.players.find((p) => p.id === this.winnerId);
      const teamMates = this.players.filter(
        (p) => p.teamId === winner?.teamId && aliveOwners.has(p.id),
      );
      if (aliveTeams.size === 1 && teamMates.length > 1) {
        this.message = `Победа команды ${winner?.teamId}: ${teamMates.map((p) => p.name).join(', ')}!`;
      } else if (aliveTeams.size === 1) {
        this.message = `${winner?.name ?? 'Игрок'} побеждает!`;
      } else {
        this.message = 'Игра окончена.';
      }
    }
  }

  isAlly(a: PlayerId, b: PlayerId): boolean {
    return isAlly(this.players, a, b);
  }

  isEnemy(a: PlayerId, b: PlayerId): boolean {
    return isEnemy(this.players, a, b);
  }

  /** Friendly land for movement: own or allied territory. */
  isFriendlyLand(unitOwner: PlayerId, hexOwner: PlayerId): boolean {
    return this.isAlly(unitOwner, hexOwner);
  }

  allies(): ReturnType<typeof alliesOf> {
    return alliesOf(this.players, this.currentPlayerId);
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
        const net = netIncome(this.cells, prov, this.farmBonusFor(prov.owner));
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
      buildTower: 'огневую точку',
      buildStrongTower: 'оборонительную линию',
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

    // Friendly territory (own or ally): move up to 2 hexes, or merge same-rank own stacks
    if (this.isFriendlyLand(unit.owner, to.owner)) {
      if (to.unit) {
        if (to.unit.owner !== unit.owner) {
          this.message = 'На клетке стоит юнит союзника.';
          return;
        }
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
        this.message =
          to.owner === unit.owner
            ? 'Дерево срублено.'
            : 'Дерево срублено на земле союзника.';
      } else {
        this.message =
          to.owner === unit.owner
            ? 'Юнит перемещён.'
            : 'Юнит перемещён по земле союзника.';
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

    if (!canCapture(this.cells, unit, to.q, to.r, (a, b) => this.isAlly(a, b))) {
      if (to.unit && to.unit.rank === unit.rank) {
        this.message = `Нужен больший отряд (у вас ×${unit.count ?? 1}, у врага ×${to.unit.count ?? 1}).`;
      } else {
        const def = defenseStrength(this.cells, to.q, to.r, to.owner, (a, b) =>
          this.isAlly(a, b),
        );
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
      spreadTrees(this.cells, this.rng, this.config.forestSpread ?? DEFAULT_FOREST_SPREAD);
      this.bumpTerrain();
    }

    this.beginPlayerTurn(this.currentPlayerId);
  }

  /** Effective AI difficulty for a player (per-nation, else global config). */
  aiDifficultyFor(ownerId: PlayerId): AiDifficulty {
    const p = this.players.find((x) => x.id === ownerId);
    if (!p || p.isHuman) return this.config.aiDifficulty;
    return p.aiDifficulty ?? this.config.aiDifficulty;
  }

  /** Extra farm income for Expert AI provinces. */
  farmBonusFor(ownerId: PlayerId): number {
    const p = this.players.find((x) => x.id === ownerId);
    if (!p || p.isHuman) return 0;
    return this.aiDifficultyFor(ownerId) === 'expert' ? EXPERT_AI_FARM_BONUS : 0;
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
      this.farmBonusFor(playerId),
    );
    // Units on ally/foreign land: charge richest own province
    const foreign = calcForeignUnitUpkeep(this.cells, playerId);
    if (foreign > 0 && mine.length) {
      const rich = [...mine].sort((a, b) => b.money - a.money)[0]!;
      rich.money -= foreign;
      if (rich.money < 0) {
        for (const key of rich.hexes) {
          const cell = this.cells[key];
          if (cell.unit && cell.unit.owner === playerId) {
            cell.unit = null;
            cell.tree = true;
          }
        }
        // Also kill foreign-stationed units of this player
        for (const key in this.cells) {
          const cell = this.cells[key];
          if (cell.unit?.owner === playerId && cell.owner !== playerId) {
            cell.unit = null;
          }
        }
        rich.money = 0;
        msgs.push('Не хватило монет на содержание юнитов за рубежом.');
      }
    }
    this.refreshProvinces();
    this.bumpUnits();
    this.checkWinner();
    if (this.winnerId) return;

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

  /** Send money from one of your provinces to an ally province. */
  transferMoney(fromProvinceId: number, toProvinceId: number, amount: number): boolean {
    if (this.winnerId || this.currentPlayerId === 0) return false;
    const from = this.provinces.find((p) => p.id === fromProvinceId);
    const to = this.provinces.find((p) => p.id === toProvinceId);
    if (!from || !to) return false;
    if (from.owner !== this.currentPlayerId) return false;
    if (!this.isAlly(from.owner, to.owner) || from.owner === to.owner) return false;
    const amt = Math.floor(amount);
    if (amt <= 0 || from.money < amt) {
      this.message = 'Недостаточно монет для перевода.';
      return false;
    }
    this.pushUndo();
    from.money -= amt;
    to.money += amt;
    const ally = this.players.find((p) => p.id === to.owner);
    this.message = `Передано ${amt}🪙 союзнику «${ally?.name ?? to.owner}».`;
    return true;
  }

  /** Send money from the selected province to an ally's largest province. */
  sendMoneyToAlly(allyId: PlayerId, amount: number): boolean {
    const from = this.selectedProvince();
    if (!from || from.owner !== this.currentPlayerId) {
      this.message = 'Выберите свою провинцию для перевода.';
      return false;
    }
    const dest = this.provinces
      .filter((p) => p.owner === allyId)
      .sort((a, b) => b.hexes.length - a.hexes.length || b.money - a.money)[0];
    if (!dest) {
      this.message = 'У союзника нет провинций.';
      return false;
    }
    return this.transferMoney(from.id, dest.id, amount);
  }

  /** Gift selected unit to an ally (ownership transfer). */
  giftUnit(unitKey: string, toPlayerId: PlayerId): boolean {
    if (this.winnerId || this.currentPlayerId === 0) return false;
    const cell = this.cells[unitKey];
    if (!cell?.unit || cell.unit.owner !== this.currentPlayerId) return false;
    if (!this.isAlly(this.currentPlayerId, toPlayerId) || toPlayerId === this.currentPlayerId) {
      this.message = 'Передавать можно только союзнику.';
      return false;
    }
    if (cell.unit.moved) {
      this.message = 'Юнит уже ходил в этот ход.';
      return false;
    }
    this.pushUndo();
    cell.unit = { ...cell.unit, owner: toPlayerId, moved: true };
    const ally = this.players.find((p) => p.id === toPlayerId);
    this.message = `${UNIT_LABEL[cell.unit.rank]} ×${cell.unit.count ?? 1} передан «${ally?.name ?? toPlayerId}».`;
    this.bumpUnits();
    this.clearSelection();
    return true;
  }

  /** Valid move targets for selected unit. */
  moveTargets(fromKey: string): Set<string> {
    const from = this.cells[fromKey];
    const result = new Set<string>();
    if (!from?.unit || from.unit.moved) return result;
    const unit = from.unit;
    const allyCheck = (a: PlayerId, b: PlayerId) => this.isAlly(a, b);

    // Own + ally territory: BFS up to 2 steps through empty friendly hexes;
    // can land on own same-rank stack to merge.
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
        if (!to || !this.isFriendlyLand(unit.owner, to.owner)) continue;
        if (to.unit) {
          // Merge only with own same-rank stacks (not allied stacks)
          if (to.unit.owner === unit.owner && to.unit.rank === unit.rank) {
            seen.add(nk);
            result.add(nk);
          }
          continue;
        }
        seen.add(nk);
        result.add(nk);
        queue.push({ key: nk, dist: dist + 1 });
      }
    }

    // Attacks / neutral capture: adjacent only, never allies
    for (const n of hexNeighbors(from.q, from.r)) {
      const nk = cellKey(n.q, n.r);
      const to = this.cells[nk];
      if (!to) continue;
      if (
        this.isEnemy(unit.owner, to.owner) &&
        canCapture(this.cells, unit, to.q, to.r, allyCheck)
      ) {
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
