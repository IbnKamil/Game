import { describe, expect, it } from 'vitest';
import { HOUSE_COST, HOUSE_TRAIN_TURNS, UNIT_COST, defaultPlayerSetup } from './constants';
import { canCapture, defenseStrength, netIncome } from './economy';
import { Game } from './Game';
import { menuToConfig, defaultMenuState, syncPlayers } from './menu';
import { cellKey, type GameConfig, type Unit } from './types';

function makeGame(seed = 42): Game {
  const players = Array.from({ length: 3 }, (_, i) => defaultPlayerSetup(i, i === 0));
  const config: GameConfig = {
    mapRadius: 7,
    playerCount: 3,
    seed,
    players,
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
    syncPlayers(state);
    state.players[0].name = 'Тестовая Республика';
    state.players[0].color = '#112233';
    const config = menuToConfig(state);
    expect(config.playerCount).toBe(5);
    expect(config.mapRadius).toBe(12);
    expect(config.players.filter((p) => p.isHuman)).toHaveLength(2);
    expect(config.players[0].name).toBe('Тестовая Республика');

    const g = new Game(config);
    expect(g.players).toHaveLength(5);
    expect(g.players[0].name).toBe('Тестовая Республика');
    expect(g.players[0].color).toBe('#112233');
    expect(g.players[1].isHuman).toBe(true);
    expect(g.players[2].isHuman).toBe(false);
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

    const attacker: Unit = { id: 99, owner: 1, rank: 1, moved: false };
    const def = defenseStrength(g.cells, target.q, target.r, 2);
    if (def === 0) {
      expect(canCapture(g.cells, attacker, target.q, target.r)).toBe(true);
    } else {
      attacker.rank = (def + 1 > 4 ? 4 : ((def + 1) as 1 | 2 | 3 | 4));
      expect(canCapture(g.cells, attacker, target.q, target.r)).toBe(true);
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
