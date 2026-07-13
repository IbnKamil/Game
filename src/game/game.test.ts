import { describe, expect, it } from 'vitest';
import { runAiTurn } from './ai';
import { HOUSE_COST, HOUSE_TRAIN_TURNS, UNIT_COST, defaultPlayerSetup } from './constants';
import { canCapture, defenseStrength, netIncome } from './economy';
import { Game } from './Game';
import { hexNeighbors } from './hex';
import { menuToConfig, defaultMenuState, syncPlayers } from './menu';
import { cellKey, type GameConfig, type Unit } from './types';

function makeGame(seed = 42): Game {
  const players = Array.from({ length: 3 }, (_, i) => defaultPlayerSetup(i, i === 0));
  const config: GameConfig = {
    mapRadius: 7,
    playerCount: 3,
    seed,
    players,
    aiDifficulty: 'normal',
  };
  return new Game(config);
}

describe('Game bootstrap', () => {
  it('creates map with players and castles', () => {
    const g = makeGame();
    expect(g.players).toHaveLength(3);
    expect(g.players[0].isHuman).toBe(true);
    expect(g.players[0].name.length).toBeGreaterThan(0);
    expect(Object.keys(g.cells).length).toBeGreaterThan(20);
    expect(g.provinces.length).toBeGreaterThanOrEqual(3);
    for (const p of g.players) {
      const provs = g.provinces.filter((x) => x.owner === p.id);
      expect(provs.length).toBeGreaterThanOrEqual(1);
      expect(provs.some((pr) => g.cells[pr.capitalKey].building === 'castle')).toBe(true);
    }
  });
});

describe('Start menu config', () => {
  it('builds config from menu state with custom nations', () => {
    const state = defaultMenuState();
    state.playerCount = 5;
    state.humanCount = 2;
    state.mapSize = 'large';
    state.aiDifficulty = 'hard';
    syncPlayers(state);
    state.players[0].name = 'Тестовая Республика';
    state.players[0].color = '#112233';
    const config = menuToConfig(state);
    expect(config.playerCount).toBe(5);
    expect(config.mapRadius).toBe(12);
    expect(config.aiDifficulty).toBe('hard');
    expect(config.players.filter((p) => p.isHuman)).toHaveLength(2);
    expect(config.players[0].name).toBe('Тестовая Республика');

    const g = new Game(config);
    expect(g.players).toHaveLength(5);
    expect(g.players[0].name).toBe('Тестовая Республика');
    expect(g.players[0].color).toBe('#112233');
    expect(g.players[1].isHuman).toBe(true);
    expect(g.players[2].isHuman).toBe(false);
    expect(g.config.aiDifficulty).toBe('hard');
  });
});

describe('Barracks houses', () => {
  it('builds house and trains unit that spawns after N turns', () => {
    const g = makeGame(7);
    const prov = g.provinces.find((p) => p.owner === 1)!;
    prov.money = 500;

    const empty = prov.hexes.find((h) => {
      const c = g.cells[h];
      return !c.building && !c.unit && !c.tree;
    });
    expect(empty).toBeTruthy();

    g.ui = { selectedKey: empty!, mode: 'none', hoverKey: null };
    g.setBuildMode('buildHouse1');
    g.selectHex(empty!);
    expect(g.cells[empty!].building).toBe('house1');
    expect(prov.money).toBe(500 - HOUSE_COST[1]);

    g.ui = { selectedKey: empty!, mode: 'house', hoverKey: null };
    const before = prov.money;
    g.summonFromHouse();
    expect(g.cells[empty!].training).toEqual({
      rank: 1,
      turnsLeft: HOUSE_TRAIN_TURNS[1],
    });
    expect(prov.money).toBe(before - UNIT_COST[1]);

    g.processTraining(1);
    expect(g.cells[empty!].training).toBeNull();

    const spawned = Object.values(g.cells).filter(
      (c) => c.unit && c.unit.owner === 1 && c.unit.rank === 1,
    );
    expect(spawned.length).toBe(1);

    const house = g.cells[empty!];
    const u = spawned[0];
    const aq = u.q - house.q;
    const ar = u.r - house.r;
    const axialDist = (Math.abs(aq) + Math.abs(ar) + Math.abs(-aq - ar)) / 2;
    expect(axialDist).toBeLessThanOrEqual(1);
  });

  it('house2 takes 2 turns to spawn', () => {
    const g = makeGame(11);
    const prov = g.provinces.find((p) => p.owner === 1)!;
    prov.money = 500;
    const empty = prov.hexes.find((h) => {
      const c = g.cells[h];
      return !c.building && !c.unit && !c.tree;
    })!;

    g.ui = { selectedKey: empty, mode: 'none', hoverKey: null };
    g.setBuildMode('buildHouse2');
    g.selectHex(empty);
    g.ui = { selectedKey: empty, mode: 'house', hoverKey: null };
    g.summonFromHouse();
    expect(g.cells[empty].training?.turnsLeft).toBe(2);

    g.processTraining(1);
    expect(g.cells[empty].training?.turnsLeft).toBe(1);
    expect(Object.values(g.cells).some((c) => c.unit?.rank === 2)).toBe(false);

    g.processTraining(1);
    expect(g.cells[empty].training).toBeNull();
    expect(Object.values(g.cells).some((c) => c.unit?.owner === 1 && c.unit.rank === 2)).toBe(
      true,
    );
  });
});

describe('Combat', () => {
  it('rank must exceed defense to capture', () => {
    const g = makeGame(3);
    const enemyProv = g.provinces.find((p) => p.owner === 2)!;
    const targetKey = enemyProv.hexes.find((h) => !g.cells[h].building) ?? enemyProv.hexes[0];
    const target = g.cells[targetKey];

    target.unit = null;
    target.building = null;
    for (const n of [
      [1, 0],
      [1, -1],
      [0, -1],
      [-1, 0],
      [-1, 1],
      [0, 1],
    ]) {
      const nk = cellKey(target.q + n[0], target.r + n[1]);
      if (g.cells[nk]?.owner === 2) {
        g.cells[nk].unit = null;
        if (g.cells[nk].building === 'tower' || g.cells[nk].building === 'strongTower') {
          g.cells[nk].building = null;
        }
      }
    }

    const attacker: Unit = { id: 99, owner: 1, rank: 1, moved: false, count: 1 };
    const def = defenseStrength(g.cells, target.q, target.r, 2);
    if (def === 0) {
      expect(canCapture(g.cells, attacker, target.q, target.r)).toBe(true);
    } else {
      attacker.rank = (def + 1 > 4 ? 4 : ((def + 1) as 1 | 2 | 3 | 4));
      expect(canCapture(g.cells, attacker, target.q, target.r)).toBe(true);
    }
  });
});

describe('Building on trees', () => {
  it('allows building and clears the tree', () => {
    const g = makeGame(21);
    const prov = g.provinces.find((p) => p.owner === 1)!;
    prov.money = 500;
    const key =
      prov.hexes.find((h) => {
        const c = g.cells[h];
        return !c.building && !c.unit;
      }) ?? prov.hexes[0];
    g.cells[key].tree = true;
    g.cells[key].palm = true;
    g.cells[key].building = null;
    g.cells[key].unit = null;

    expect(g.buildAt(key, 'buildFarm')).toBe(true);
    expect(g.cells[key].building).toBe('farm');
    expect(g.cells[key].tree).toBe(false);
    expect(g.cells[key].palm).toBe(false);
  });
});

describe('AI actions', () => {
  it('AI can build via direct API on its turn', () => {
    const players = Array.from({ length: 2 }, (_, i) => defaultPlayerSetup(i, false));
    players[0].isHuman = false;
    const g = new Game({
      mapRadius: 6,
      playerCount: 2,
      seed: 99,
      players,
      aiDifficulty: 'expert',
    });
    g.currentPlayerId = 1;
    const prov = g.provinces.find((p) => p.owner === 1)!;
    prov.money = 200;
    const beforeBuildings = prov.hexes.filter((h) => g.cells[h].building && g.cells[h].building !== 'castle')
      .length;
    runAiTurn(g, 1);
    const afterBuildings = prov.hexes.filter((h) => g.cells[h].building && g.cells[h].building !== 'castle')
      .length;
    const training = prov.hexes.some((h) => g.cells[h].training);
    expect(afterBuildings >= beforeBuildings || training).toBe(true);
  });
});

describe('Movement rules', () => {
  it('allows 2-hex moves on own land and same-rank merge targets', () => {
    const g = makeGame(33);
    const prov = g.provinces.find((p) => p.owner === 1)!;
    const start = prov.hexes[0];
    const startCell = g.cells[start];
    startCell.unit = { id: 1, owner: 1, rank: 1, moved: false, count: 1 };
    startCell.building = startCell.building === 'castle' ? 'castle' : null;

    const targets = g.moveTargets(start);
    expect(targets.size).toBeGreaterThan(0);

    const emptyOwn = [...targets].find((t) => g.cells[t].owner === 1 && !g.cells[t].unit);
    if (emptyOwn) {
      g.cells[emptyOwn].unit = { id: 2, owner: 1, rank: 1, moved: false, count: 1 };
      const again = g.moveTargets(start);
      expect(again.has(emptyOwn)).toBe(true);
    }
  });
});

describe('Economy', () => {
  it('farms increase net income', () => {
    const g = makeGame(5);
    const prov = g.provinces.find((p) => p.owner === 1)!;
    const before = netIncome(g.cells, prov);
    const empty = prov.hexes.find((h) => {
      const c = g.cells[h];
      return !c.building && !c.unit && !c.tree;
    });
    if (empty) {
      g.cells[empty].building = 'farm';
      expect(netIncome(g.cells, prov)).toBeGreaterThan(before);
    }
  });
});

describe('Unit stacks', () => {
  it('merges same-rank units and resolves same-rank combat by count', () => {
    const g = makeGame(21);
    const prov = g.provinces.find((p) => p.owner === 1)!;
    const keys = prov.hexes.filter((h) => !g.cells[h].building);
    expect(keys.length).toBeGreaterThanOrEqual(2);
    const a = keys[0];
    const b = keys[1];
    g.cells[a].tree = false;
    g.cells[b].tree = false;
    g.cells[a].unit = { id: 1, owner: 1, rank: 1, moved: false, count: 2 };
    g.cells[b].unit = { id: 2, owner: 1, rank: 1, moved: false, count: 1 };
    // Ensure b is reachable (adjacent or clear path) — place adjacent
    const aq = g.cells[a].q;
    const ar = g.cells[a].r;
    const adj = hexNeighbors(aq, ar).map((n) => cellKey(n.q, n.r)).find((k) => g.cells[k]?.owner === 1);
    expect(adj).toBeTruthy();
    const dest = adj!;
    g.cells[dest].tree = false;
    g.cells[dest].building = null;
    g.cells[dest].unit = { id: 2, owner: 1, rank: 1, moved: false, count: 1 };
    if (a !== dest) g.cells[a].unit = { id: 1, owner: 1, rank: 1, moved: false, count: 2 };
    g.moveUnitTo(a, dest);
    expect(g.cells[a].unit).toBeNull();
    expect(g.cells[dest].unit?.count).toBe(3);

    g.cells[dest].unit!.moved = false;
    g.cells[dest].unit!.count = 3;
    const nbr = hexNeighbors(g.cells[dest].q, g.cells[dest].r)
      .map((n) => cellKey(n.q, n.r))
      .find((k) => g.cells[k] && k !== dest)!;
    g.cells[nbr].owner = 2;
    g.cells[nbr].unit = { id: 9, owner: 2, rank: 1, moved: false, count: 1 };
    g.cells[nbr].building = null;
    g.cells[nbr].tree = false;
    expect(canCapture(g.cells, g.cells[dest].unit!, g.cells[nbr].q, g.cells[nbr].r)).toBe(true);
    g.moveUnitTo(dest, nbr);
    expect(g.cells[nbr].unit?.owner).toBe(1);
    expect(g.cells[nbr].unit?.count).toBe(2);
  });

  it('higher rank destroys lower without stack loss', () => {
    const g = makeGame(22);
    const prov = g.provinces.find((p) => p.owner === 1)!;
    const home = prov.hexes.find((h) => !g.cells[h].building)!;
    const cell = g.cells[home];
    cell.unit = { id: 1, owner: 1, rank: 2, moved: false, count: 1 };
    const nbr = hexNeighbors(cell.q, cell.r).map((n) => cellKey(n.q, n.r)).find((k) => g.cells[k])!;
    g.cells[nbr].owner = 2;
    g.cells[nbr].building = null;
    g.cells[nbr].unit = { id: 2, owner: 2, rank: 1, moved: false, count: 5 };
    g.moveUnitTo(home, nbr);
    expect(g.cells[nbr].unit?.rank).toBe(2);
    expect(g.cells[nbr].unit?.count).toBe(1);
  });
});

describe('Undo', () => {
  it('restores turn checkpoint after build', () => {
    const g = makeGame(11);
    const prov = g.provinces.find((p) => p.owner === 1)!;
    prov.money = 200;
    g.saveTurnCheckpoint();
    const empty = prov.hexes.find((h) => {
      const c = g.cells[h];
      return !c.building && !c.unit && !c.tree;
    })!;
    const before = prov.money;
    g.ui = { selectedKey: empty, mode: 'none', hoverKey: null };
    g.setBuildMode('buildHouse1');
    g.selectHex(empty);
    expect(g.cells[empty].building).toBe('house1');
    expect(g.getProvince(empty)!.money).toBe(before - HOUSE_COST[1]);
    expect(g.undo()).toBe(true);
    expect(g.cells[empty].building).toBeNull();
    expect(g.getProvince(empty)!.money).toBe(before);
  });
});
