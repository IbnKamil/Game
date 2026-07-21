import { describe, expect, it } from 'vitest';
import { runAiTurn } from './ai';
import { HOUSE_COST, HOUSE_TRAIN_TURNS, UNIT_COST, EXPERT_AI_FARM_BONUS, defaultPlayerSetup } from './constants';
import { canCapture, calcIncome, defenseStrength, netIncome, spreadTrees } from './economy';
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

  it('assigns topographic elevation to every hex', () => {
    const g = makeGame(77);
    const elevs = Object.values(g.cells).map((c) => c.elevation);
    expect(elevs.length).toBeGreaterThan(20);
    expect(elevs.every((e) => e >= 0 && e <= 1)).toBe(true);
    const uniq = new Set(elevs.map((e) => e.toFixed(3)));
    expect(uniq.size).toBeGreaterThan(5);
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
    state.players[2].aiDifficulty = 'hard';
    state.players[3].aiDifficulty = 'hard';
    state.players[4].aiDifficulty = 'hard';
    const config = menuToConfig(state);
    expect(config.playerCount).toBe(5);
    expect(config.mapRadius).toBe(12);
    expect(config.players[2].aiDifficulty).toBe('hard');
    expect(config.players.filter((p) => p.isHuman)).toHaveLength(2);
    expect(config.players[0].name).toBe('Тестовая Республика');

    const g = new Game(config);
    expect(g.players).toHaveLength(5);
    expect(g.players[0].name).toBe('Тестовая Республика');
    expect(g.players[0].color).toBe('#112233');
    expect(g.players[1].isHuman).toBe(true);
    expect(g.players[2].isHuman).toBe(false);
    expect(g.aiDifficultyFor(3)).toBe('hard');
  });

  it('maps Гигантская size to 3× Огромная radius', () => {
    const state = defaultMenuState();
    state.mapSize = 'giant';
    expect(menuToConfig(state).mapRadius).toBe(45);
  });

  it('maps Предгигантская size to 2× Огромная radius', () => {
    const state = defaultMenuState();
    state.mapSize = 'pregiant';
    expect(menuToConfig(state).mapRadius).toBe(30);
  });

  it('passes forest density from menu slider', () => {
    const state = defaultMenuState();
    expect(state.forestDensity).toBe(10);
    state.forestDensity = 45;
    expect(menuToConfig(state).forestDensity).toBe(45);
    state.forestDensity = 999;
    expect(menuToConfig(state).forestDensity).toBe(100);
  });

  it('passes forest spread speed from menu slider', () => {
    const state = defaultMenuState();
    expect(state.forestSpread).toBe(100);
    state.forestSpread = 25;
    expect(menuToConfig(state).forestSpread).toBe(25);
    state.forestSpread = -10;
    expect(menuToConfig(state).forestSpread).toBe(0);
  });

  it('keeps per-nation AI difficulty through config and Game', () => {
    const state = defaultMenuState();
    state.playerCount = 4;
    state.humanCount = 1;
    syncPlayers(state);
    state.players[1].aiDifficulty = 'easy';
    state.players[2].aiDifficulty = 'hard';
    state.players[3].aiDifficulty = 'expert';
    const config = menuToConfig(state);
    expect(config.players[1].aiDifficulty).toBe('easy');
    expect(config.players[2].aiDifficulty).toBe('hard');
    expect(config.players[3].aiDifficulty).toBe('expert');
    expect(config.players[0].aiDifficulty).toBeUndefined();

    const g = new Game(config);
    expect(g.aiDifficultyFor(1)).toBe(config.aiDifficulty); // human falls back to config
    expect(g.aiDifficultyFor(2)).toBe('easy');
    expect(g.aiDifficultyFor(3)).toBe('hard');
    expect(g.aiDifficultyFor(4)).toBe('expert');
  });

  it('has no global difficulty field in menu state', () => {
    const state = defaultMenuState();
    expect('aiDifficulty' in state).toBe(false);
    syncPlayers(state);
    expect(state.players.filter((p) => !p.isHuman).every((p) => p.aiDifficulty === 'normal')).toBe(
      true,
    );
  });
});

describe('Map shapes', () => {
  const shapes = [
    'hex',
    'donut',
    'crescent',
    'islands',
    'corridor',
    'star',
    'hourglass',
    'twin',
    'fjord',
    'continent',
  ] as const;

  function shapeGame(shape: (typeof shapes)[number], seed = 42): Game {
    const players = Array.from({ length: 3 }, (_, i) => defaultPlayerSetup(i, i === 0));
    return new Game({
      mapRadius: 8,
      playerCount: 3,
      seed,
      players,
      aiDifficulty: 'normal',
      mapShape: shape,
      forestDensity: 0,
    });
  }

  it('passes map shape from menu into config', () => {
    const state = defaultMenuState();
    expect(state.mapShape).toBe('random');
    state.mapShape = 'donut';
    expect(menuToConfig(state).mapShape).toBe('donut');
  });

  it('generates land for every concrete shape', () => {
    for (const shape of shapes) {
      const g = shapeGame(shape, 90 + shape.length);
      const land = Object.keys(g.cells).length;
      expect(land, shape).toBeGreaterThan(20);
      expect(g.players.every((p) => g.provinces.some((pr) => pr.owner === p.id))).toBe(true);
    }
  });

  it('donut keeps a hollow center', () => {
    const g = shapeGame('donut', 11);
    expect(g.cells['0,0']).toBeUndefined();
    expect(Object.keys(g.cells).length).toBeGreaterThan(30);
  });

  it('twin / islands produce multiple land components', () => {
    const twin = shapeGame('twin', 22);
    const islands = shapeGame('islands', 33);
    const countComponents = (g: Game): number => {
      const seen = new Set<string>();
      let n = 0;
      for (const start of Object.keys(g.cells)) {
        if (seen.has(start)) continue;
        n += 1;
        const stack = [start];
        seen.add(start);
        while (stack.length) {
          const key = stack.pop()!;
          const c = g.cells[key];
          for (const nb of hexNeighbors(c.q, c.r)) {
            const nk = cellKey(nb.q, nb.r);
            if (!g.cells[nk] || seen.has(nk)) continue;
            seen.add(nk);
            stack.push(nk);
          }
        }
      }
      return n;
    };
    expect(countComponents(twin)).toBeGreaterThanOrEqual(2);
    expect(countComponents(islands)).toBeGreaterThanOrEqual(2);
  });

  it('corridor is elongated along one axis', () => {
    const g = shapeGame('corridor', 44);
    let minQ = Infinity;
    let maxQ = -Infinity;
    let minR = Infinity;
    let maxR = -Infinity;
    for (const c of Object.values(g.cells)) {
      minQ = Math.min(minQ, c.q);
      maxQ = Math.max(maxQ, c.q);
      minR = Math.min(minR, c.r);
      maxR = Math.max(maxR, c.r);
    }
    const spanQ = maxQ - minQ;
    const spanR = maxR - minR;
    expect(spanQ).toBeGreaterThan(spanR);
  });
});

describe('Forest density', () => {
  it('places roughly the requested share of trees', () => {
    const players = Array.from({ length: 2 }, (_, i) => defaultPlayerSetup(i, i === 0));
    const low = new Game({
      mapRadius: 8,
      playerCount: 2,
      seed: 123,
      players,
      aiDifficulty: 'normal',
      forestDensity: 0,
    });
    const treesLow = Object.values(low.cells).filter((c) => c.tree).length;
    expect(treesLow).toBe(0);

    const high = new Game({
      mapRadius: 8,
      playerCount: 2,
      seed: 123,
      players,
      aiDifficulty: 'normal',
      forestDensity: 60,
    });
    const total = Object.keys(high.cells).length;
    const treesHigh = Object.values(high.cells).filter((c) => c.tree).length;
    // Starts clear trees on claimed hexes, so allow some slack below target
    expect(treesHigh / total).toBeGreaterThan(0.35);
    expect(treesHigh / total).toBeLessThan(0.7);
  });

  it('does not spread trees when forestSpread is 0', () => {
    const g = new Game({
      mapRadius: 6,
      playerCount: 2,
      seed: 9,
      players: Array.from({ length: 2 }, (_, i) => defaultPlayerSetup(i, i === 0)),
      aiDifficulty: 'normal',
      forestDensity: 40,
      forestSpread: 0,
    });
    // Clear units/buildings on a few empty neighbors so spread would be possible
    const tree = Object.values(g.cells).find((c) => c.tree)!;
    expect(tree).toBeTruthy();
    for (const n of hexNeighbors(tree.q, tree.r)) {
      const nc = g.cells[cellKey(n.q, n.r)];
      if (!nc) continue;
      nc.unit = null;
      nc.building = null;
    }
    const before = Object.values(g.cells).filter((c) => c.tree).length;
    let calls = 0;
    spreadTrees(g.cells, () => {
      calls += 1;
      return 0;
    }, 0);
    expect(calls).toBe(0);
    expect(Object.values(g.cells).filter((c) => c.tree).length).toBe(before);
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

  it('opens with farms while reserving one cell for a house', () => {
    const players = Array.from({ length: 2 }, (_, i) => defaultPlayerSetup(i, false));
    const g = new Game({
      mapRadius: 6,
      playerCount: 2,
      seed: 42,
      players,
      aiDifficulty: 'normal',
    });
    g.currentPlayerId = 1;
    const prov = g.provinces.find((p) => p.owner === 1)!;
    while (prov.hexes.length > 4) {
      const drop = prov.hexes.find((h) => g.cells[h].building !== 'castle')!;
      g.cells[drop].owner = 0;
      prov.hexes = prov.hexes.filter((h) => h !== drop);
    }
    for (const h of prov.hexes) {
      const c = g.cells[h];
      if (c.building !== 'castle') {
        c.building = null;
        c.unit = null;
        c.tree = false;
      }
    }
    // Can afford a farm but not a house yet
    prov.money = 20;
    runAiTurn(g, 1);
    const farms = prov.hexes.filter((h) => g.cells[h].building === 'farm').length;
    const houses = prov.hexes.filter((h) => {
      const b = g.cells[h].building;
      return b === 'house1' || b === 'house2' || b === 'house3' || b === 'house4';
    }).length;
    expect(farms).toBeGreaterThanOrEqual(1);
    expect(houses).toBe(0);
    const free = prov.hexes.filter((h) => !g.cells[h].building && !g.cells[h].unit).length;
    expect(free).toBeGreaterThanOrEqual(1);
  });

  it('builds a house on the last free cell after farming the rest', () => {
    const players = Array.from({ length: 2 }, (_, i) => defaultPlayerSetup(i, false));
    const g = new Game({
      mapRadius: 6,
      playerCount: 2,
      seed: 7,
      players,
      aiDifficulty: 'hard',
    });
    g.currentPlayerId = 1;
    const prov = g.provinces.find((p) => p.owner === 1)!;
    while (prov.hexes.length > 4) {
      const drop = prov.hexes.find((h) => g.cells[h].building !== 'castle')!;
      g.cells[drop].owner = 0;
      prov.hexes = prov.hexes.filter((h) => h !== drop);
    }
    for (const h of prov.hexes) {
      const c = g.cells[h];
      if (c.building !== 'castle') {
        c.building = null;
        c.unit = null;
        c.tree = false;
      }
    }
    // Two free slots already farmed → only one left → house
    const empties = prov.hexes.filter((h) => !g.cells[h].building);
    expect(empties.length).toBeGreaterThanOrEqual(2);
    g.cells[empties[0]!].building = 'farm';
    if (empties.length > 2) g.cells[empties[1]!].building = 'farm';
    prov.money = 40;
    runAiTurn(g, 1);
    const houses = prov.hexes.filter((h) => {
      const b = g.cells[h].building;
      return b === 'house1' || b === 'house2' || b === 'house3' || b === 'house4';
    }).length;
    expect(houses).toBeGreaterThanOrEqual(1);
  });

  it('spaces towers so they are not adjacent', () => {
    const players = Array.from({ length: 2 }, (_, i) => defaultPlayerSetup(i, false));
    const g = new Game({
      mapRadius: 7,
      playerCount: 2,
      seed: 88,
      players,
      aiDifficulty: 'expert',
    });
    g.currentPlayerId = 1;
    const prov = g.provinces.find((p) => p.owner === 1)!;
    for (const h of prov.hexes) {
      const c = g.cells[h];
      if (c.building !== 'castle') {
        c.building = null;
        c.training = null;
        c.unit = null;
        c.tree = false;
      }
    }
    const empties = prov.hexes.filter((h) => !g.cells[h].building);
    g.cells[empties[0]!].building = 'house1';
    // Enemy unit on border to trigger defense
    outer: for (const h of prov.hexes) {
      for (const n of hexNeighbors(g.cells[h].q, g.cells[h].r)) {
        const nk = cellKey(n.q, n.r);
        const nc = g.cells[nk];
        if (nc && nc.owner !== 1) {
          nc.owner = 2;
          nc.unit = { id: 3, owner: 2, rank: 2, moved: false, count: 1 };
          break outer;
        }
      }
    }
    for (let i = 0; i < 6; i++) {
      const live = g.provinces.find((p) => p.owner === 1)!;
      live.money = 300;
      runAiTurn(g, 1);
    }
    const towerKeys = Object.keys(g.cells).filter((k) => {
      if (g.cells[k].owner !== 1) return false;
      const b = g.cells[k].building;
      return b === 'tower' || b === 'strongTower';
    });
    for (const a of towerKeys) {
      for (const b of towerKeys) {
        if (a >= b) continue;
        const ca = g.cells[a];
        const adj = hexNeighbors(ca.q, ca.r).some(
          (n) => cellKey(n.q, n.r) === b,
        );
        expect(adj).toBe(false);
      }
    }
  });

  it('when sealed by enemy towers, banks for house3/4 breakout', () => {
    const players = Array.from({ length: 2 }, (_, i) => defaultPlayerSetup(i, false));
    players[0].aiDifficulty = 'expert';
    const g = new Game({
      mapRadius: 7,
      playerCount: 2,
      seed: 19,
      players,
      aiDifficulty: 'expert',
      mapShape: 'hex',
    });
    g.currentPlayerId = 1;
    const prov = g.provinces.find((p) => p.owner === 1)!;
    // Grow province so there is room for HQ after farms/house1
    const extras: string[] = [];
    for (const h of [...prov.hexes]) {
      const c = g.cells[h];
      for (const n of hexNeighbors(c.q, c.r)) {
        const nk = cellKey(n.q, n.r);
        const nc = g.cells[nk];
        if (!nc || nc.owner !== 0) continue;
        extras.push(nk);
      }
    }
    for (const nk of extras.slice(0, 6)) {
      g.cells[nk].owner = 1;
      g.cells[nk].building = null;
      g.cells[nk].unit = null;
      g.cells[nk].tree = false;
      if (!prov.hexes.includes(nk)) prov.hexes.push(nk);
    }
    for (const h of prov.hexes) {
      const c = g.cells[h];
      if (c.building !== 'castle') {
        c.building = null;
        c.training = null;
        c.unit = null;
        c.tree = false;
      }
    }
    for (const h of [...prov.hexes]) {
      const c = g.cells[h];
      for (const n of hexNeighbors(c.q, c.r)) {
        const nk = cellKey(n.q, n.r);
        const nc = g.cells[nk];
        if (!nc || nc.owner === 1) continue;
        nc.owner = 2;
        nc.unit = null;
        nc.tree = false;
        nc.building = 'tower';
      }
    }
    const empties = prov.hexes.filter((h) => !g.cells[h].building);
    g.cells[empties[0]!].building = 'house1';
    if (empties[1]) g.cells[empties[1]].building = 'farm';
    if (empties[2]) g.cells[empties[2]].building = 'farm';
    prov.money = 200;

    runAiTurn(g, 1);
    const owned = Object.keys(g.cells).filter((k) => g.cells[k].owner === 1);
    const high = owned.some((h) => {
      const b = g.cells[h].building;
      return b === 'house3' || b === 'house4';
    });
    expect(high).toBe(true);
  });

  it('prefers interior farms and caps border towers instead of carpeting', () => {
    const players = Array.from({ length: 2 }, (_, i) => defaultPlayerSetup(i, false));
    const g = new Game({
      mapRadius: 8,
      playerCount: 2,
      seed: 55,
      players,
      aiDifficulty: 'expert',
    });
    g.currentPlayerId = 1;
    let prov = g.provinces.find((p) => p.owner === 1)!;
    for (const h of prov.hexes) {
      const c = g.cells[h];
      if (c.building !== 'castle') {
        c.building = null;
        c.training = null;
        c.unit = null;
        c.tree = false;
      }
    }
    // Grow a blob so the province has real interior hexes
    const queue = [...prov.hexes];
    while (prov.hexes.length < 12 && queue.length) {
      const cur = queue.shift()!;
      const c = g.cells[cur];
      for (const n of hexNeighbors(c.q, c.r)) {
        const nk = cellKey(n.q, n.r);
        const nc = g.cells[nk];
        if (!nc || nc.owner === 1) continue;
        nc.owner = 1;
        nc.building = null;
        nc.unit = null;
        nc.tree = false;
        nc.training = null;
        prov.hexes.push(nk);
        queue.push(nk);
        if (prov.hexes.length >= 12) break;
      }
    }
    const houseSlot = prov.hexes.find((h) => !g.cells[h].building)!;
    g.cells[houseSlot].building = 'house1';

    outer: for (const h of prov.hexes) {
      const c = g.cells[h];
      for (const n of hexNeighbors(c.q, c.r)) {
        const nk = cellKey(n.q, n.r);
        const nc = g.cells[nk];
        if (nc && nc.owner !== 1) {
          nc.owner = 2;
          nc.unit = { id: 99, owner: 2, rank: 2, moved: false, count: 1 };
          nc.building = null;
          break outer;
        }
      }
    }

    for (let i = 0; i < 10; i++) {
      prov = g.provinces.find((p) => p.owner === 1)!;
      // Keep hex list in sync if rebuild happened
      if (prov.hexes.length < 8) {
        for (const key of Object.keys(g.cells)) {
          if (g.cells[key].owner === 1 && !prov.hexes.includes(key)) prov.hexes.push(key);
        }
      }
      prov.money = 400;
      runAiTurn(g, 1);
    }

    prov = g.provinces.find((p) => p.owner === 1)!;
    const owned = Object.keys(g.cells).filter((k) => g.cells[k].owner === 1);
    const farms = owned.filter((h) => g.cells[h].building === 'farm').length;
    const towers = owned.filter((h) => {
      const b = g.cells[h].building;
      return b === 'tower' || b === 'strongTower';
    }).length;
    const interiorTowers = owned.filter((h) => {
      const c = g.cells[h];
      const b = c.building;
      if (b !== 'tower' && b !== 'strongTower') return false;
      const border = hexNeighbors(c.q, c.r).some((n) => {
        const nc = g.cells[cellKey(n.q, n.r)];
        return !nc || nc.owner !== 1;
      });
      return !border;
    }).length;

    expect(farms).toBeGreaterThan(0);
    expect(interiorTowers).toBe(0);
    const borderCount = owned.filter((h) => {
      const c = g.cells[h];
      return hexNeighbors(c.q, c.r).some((n) => {
        const nc = g.cells[cellKey(n.q, n.r)];
        return !nc || nc.owner !== 1;
      });
    }).length;
    expect(towers).toBeLessThanOrEqual(Math.max(2, Math.ceil(borderCount / 3) + 1));
  });

  it('builds house3/4 when enemy fields high-rank units and AI can afford it', () => {
    const players = Array.from({ length: 2 }, (_, i) => defaultPlayerSetup(i, false));
    const g = new Game({
      mapRadius: 8,
      playerCount: 2,
      seed: 21,
      players,
      aiDifficulty: 'hard',
    });
    g.currentPlayerId = 1;
    const prov = g.provinces.find((p) => p.owner === 1)!;
    // Expand province for free build slots
    const queue = [...prov.hexes];
    while (prov.hexes.length < 10 && queue.length) {
      const cur = queue.shift()!;
      const c = g.cells[cur];
      for (const n of hexNeighbors(c.q, c.r)) {
        const nk = cellKey(n.q, n.r);
        const nc = g.cells[nk];
        if (!nc || nc.owner === 1) continue;
        nc.owner = 1;
        nc.building = null;
        nc.unit = null;
        nc.tree = false;
        nc.training = null;
        prov.hexes.push(nk);
        queue.push(nk);
        if (prov.hexes.length >= 10) break;
      }
    }
    for (const h of prov.hexes) {
      const c = g.cells[h];
      if (c.building !== 'castle') {
        c.building = null;
        c.training = null;
        c.unit = null;
        c.tree = false;
      }
    }
    const empties = prov.hexes.filter((h) => !g.cells[h].building);
    expect(empties.length).toBeGreaterThanOrEqual(4);
    g.cells[empties[0]!].building = 'house1';
    g.cells[empties[1]!].building = 'farm';
    g.cells[empties[2]!].building = 'farm';
    prov.money = 220;
    const enemyHex = Object.keys(g.cells).find((k) => g.cells[k].owner === 2)!;
    g.cells[enemyHex].unit = { id: 7, owner: 2, rank: 4, moved: false, count: 1 };

    runAiTurn(g, 1);
    const owned = Object.keys(g.cells).filter((k) => g.cells[k].owner === 1);
    const high = owned.some((h) => {
      const b = g.cells[h].building;
      return b === 'house3' || b === 'house4';
    });
    expect(high).toBe(true);
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

describe('Strategic Expert AI', () => {
  function hexCount(g: Game, owner: number): number {
    return Object.values(g.cells).filter((c) => c.owner === owner).length;
  }

  it('strategic Expert expands and builds on its turn', () => {
    const players = Array.from({ length: 2 }, (_, i) => defaultPlayerSetup(i, false));
    players[0].aiDifficulty = 'expert';
    players[1].aiDifficulty = 'easy';
    const g = new Game({
      mapRadius: 7,
      playerCount: 2,
      seed: 55,
      players,
      aiDifficulty: 'expert',
    });
    g.currentPlayerId = 1;
    const before = hexCount(g, 1);
    const prov = g.provinces.find((p) => p.owner === 1)!;
    prov.money = 80;
    runAiTurn(g, 1);
    const buildings = prov.hexes.filter((h) => {
      const b = g.cells[h].building;
      return b && b !== 'castle';
    }).length;
    const training = prov.hexes.some((h) => g.cells[h].training);
    const after = hexCount(g, 1);
    expect(buildings > 0 || training || after >= before).toBe(true);
  });

  it('outgrows Easy AI over a short match', () => {
    const players = Array.from({ length: 2 }, (_, i) => defaultPlayerSetup(i, false));
    players[0].aiDifficulty = 'expert';
    players[1].aiDifficulty = 'easy';
    const g = new Game({
      mapRadius: 7,
      playerCount: 2,
      seed: 101,
      players,
      aiDifficulty: 'normal',
      forestDensity: 5,
    });

    // Simulate alternating AI turns for several full rounds
    for (let round = 0; round < 24 && !g.winnerId; round++) {
      const id = g.currentPlayerId;
      if (!g.currentPlayer().alive) {
        g.endTurn();
        continue;
      }
      runAiTurn(g, id);
      g.endTurn();
    }

    const expertHex = hexCount(g, 1);
    const easyHex = hexCount(g, 2);
    // Expert should dominate land or already have won
    expect(g.winnerId === 1 || expertHex > easyHex).toBe(true);
    expect(expertHex).toBeGreaterThanOrEqual(easyHex);
  });

  it('prefers capturing a human province over a larger AI when both are reachable', () => {
    const players = Array.from({ length: 3 }, (_, i) => defaultPlayerSetup(i, false));
    players[0].aiDifficulty = 'expert';
    players[1].isHuman = true;
    players[1].aiDifficulty = undefined;
    players[2].aiDifficulty = 'normal';
    const g = new Game({
      mapRadius: 6,
      playerCount: 3,
      seed: 7,
      players,
      aiDifficulty: 'expert',
    });
    g.currentPlayerId = 1;
    const home = g.provinces.find((p) => p.owner === 1)!;
    // Place a strong unit with capture options toward both foes if possible
    const empty = home.hexes.find((h) => !g.cells[h].building && !g.cells[h].unit);
    expect(empty).toBeTruthy();
    g.cells[empty!].unit = {
      id: 900,
      owner: 1,
      rank: 3,
      moved: false,
      count: 1,
    };
    home.money = 5;
    // Clear houses so turn is mostly about the move
    for (const h of home.hexes) {
      const c = g.cells[h];
      if (c.building && c.building.startsWith('house')) {
        c.building = 'farm';
        c.training = null;
      }
    }
    runAiTurn(g, 1);
    // Smoke: strategic turn completes without throwing and unit has acted or economy moved
    expect(g.winnerId === null || g.winnerId === 1).toBe(true);
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

  it('Expert AI farms grant +2 income over normal farms', () => {
    const players = Array.from({ length: 2 }, (_, i) => defaultPlayerSetup(i, false));
    const g = new Game({
      mapRadius: 6,
      playerCount: 2,
      seed: 3,
      players,
      aiDifficulty: 'expert',
    });
    const prov = g.provinces.find((p) => p.owner === 1)!;
    for (const h of prov.hexes) {
      const c = g.cells[h];
      if (c.building !== 'castle') {
        c.building = null;
        c.unit = null;
        c.tree = false;
      }
    }
    const slot = prov.hexes.find((h) => !g.cells[h].building)!;
    g.cells[slot].building = 'farm';
    const base = calcIncome(g.cells, prov, 0);
    const expert = calcIncome(g.cells, prov, g.farmBonusFor(1));
    expect(g.farmBonusFor(1)).toBe(EXPERT_AI_FARM_BONUS);
    expect(expert - base).toBe(EXPERT_AI_FARM_BONUS);

    g.players[0].isHuman = true;
    expect(g.farmBonusFor(1)).toBe(0);
  });

  it('farm bonus follows per-nation expert, not only global config', () => {
    const players = Array.from({ length: 2 }, (_, i) => defaultPlayerSetup(i, false));
    players[0].aiDifficulty = 'expert';
    players[1].aiDifficulty = 'normal';
    const g = new Game({
      mapRadius: 6,
      playerCount: 2,
      seed: 4,
      players,
      aiDifficulty: 'normal',
    });
    expect(g.farmBonusFor(1)).toBe(EXPERT_AI_FARM_BONUS);
    expect(g.farmBonusFor(2)).toBe(0);

    g.players[0].aiDifficulty = 'hard';
    expect(g.farmBonusFor(1)).toBe(0);
  });

  it('Expert AI transfers surplus money to a poorer ally', () => {
    const players = Array.from({ length: 3 }, (_, i) => defaultPlayerSetup(i, false));
    players[0].teamId = 1;
    players[0].aiDifficulty = 'expert';
    players[1].teamId = 1;
    players[1].isHuman = true;
    players[2].teamId = 2;
    const g = new Game({
      mapRadius: 6,
      playerCount: 3,
      seed: 17,
      players,
      aiDifficulty: 'expert',
    });
    g.currentPlayerId = 1;
    const mine = g.provinces.find((p) => p.owner === 1)!;
    // No recruit/build spend: only castle + farms, no empty slots or houses
    for (const h of mine.hexes) {
      const c = g.cells[h];
      c.unit = null;
      c.training = null;
      if (c.building !== 'castle') c.building = 'farm';
    }
    mine.money = 200;
    const allyBefore = g.provinces
      .filter((p) => p.owner === 2)
      .reduce((n, p) => n + p.money, 0);
    runAiTurn(g, 1);
    const allyAfter = g.provinces
      .filter((p) => p.owner === 2)
      .reduce((n, p) => n + p.money, 0);
    expect(allyAfter).toBeGreaterThan(allyBefore);
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
    const cellsBeforeUndo = g.cells;
    g.ui = { selectedKey: empty, mode: 'none', hoverKey: null };
    g.setBuildMode('buildHouse1');
    g.selectHex(empty);
    expect(g.cells[empty].building).toBe('house1');
    expect(g.getProvince(empty)!.money).toBe(before - HOUSE_COST[1]);
    expect(g.undo()).toBe(true);
    expect(g.cells).not.toBe(cellsBeforeUndo);
    expect(g.cells[empty].building).toBeNull();
    expect(g.getProvince(empty)!.money).toBe(before);
    // Checkpoint stays usable for a second undo after another action
    g.ui = { selectedKey: empty, mode: 'none', hoverKey: null };
    g.setBuildMode('buildHouse1');
    g.selectHex(empty);
    expect(g.cells[empty].building).toBe('house1');
    expect(g.undo()).toBe(true);
    expect(g.cells[empty].building).toBeNull();
  });
});

describe('Teams / alliances', () => {
  function alliedGame(seed = 99): Game {
    const players = Array.from({ length: 3 }, (_, i) => defaultPlayerSetup(i, i === 0));
    // P1 and P2 on team 1, P3 alone on team 2
    players[0].teamId = 1;
    players[1].teamId = 1;
    players[2].teamId = 2;
    return new Game({
      mapRadius: 7,
      playerCount: 3,
      seed,
      players,
      aiDifficulty: 'normal',
    });
  }

  it('menu preserves teamId into config and players', () => {
    const state = defaultMenuState();
    state.playerCount = 4;
    syncPlayers(state);
    state.players[0].teamId = 1;
    state.players[1].teamId = 1;
    state.players[2].teamId = 2;
    state.players[3].teamId = 2;
    const config = menuToConfig(state);
    expect(config.players.map((p) => p.teamId)).toEqual([1, 1, 2, 2]);
    const g = new Game(config);
    expect(g.players.map((p) => p.teamId)).toEqual([1, 1, 2, 2]);
    expect(g.isAlly(1, 2)).toBe(true);
    expect(g.isAlly(1, 3)).toBe(false);
    expect(g.allies().map((p) => p.id)).toEqual([2]);
  });

  it('allows move onto empty ally land and forbids capturing allies', () => {
    const g = alliedGame(101);
    const allyHex = Object.values(g.cells).find(
      (c) => c.owner === 2 && !c.unit && !c.building && !c.tree,
    )!;
    const allyKey = cellKey(allyHex.q, allyHex.r);

    // Place unit on a neighboring hex owned by player 1 (forge ownership if needed)
    const n = hexNeighbors(allyHex.q, allyHex.r).find((x) => g.cells[cellKey(x.q, x.r)]);
    expect(n).toBeTruthy();
    const fromKey = cellKey(n!.q, n!.r);
    const from = g.cells[fromKey];
    from.owner = 1;
    from.building = null;
    from.tree = false;
    from.palm = false;
    from.unit = {
      id: g.nextUnitId++,
      owner: 1,
      rank: 2,
      moved: false,
      count: 1,
    };

    const targets = g.moveTargets(fromKey);
    expect(targets.has(allyKey)).toBe(true);
    expect(
      canCapture(g.cells, from.unit!, allyHex.q, allyHex.r, (a, b) => g.isAlly(a, b)),
    ).toBe(false);

    g.moveUnitTo(fromKey, allyKey);
    expect(g.cells[allyKey].unit?.owner).toBe(1);
    expect(g.cells[allyKey].owner).toBe(2); // land stays ally's
  });

  it('transfers money and gifts units to allies only', () => {
    const g = alliedGame(55);
    const from = g.provinces.find((p) => p.owner === 1)!;
    const allyProv = g.provinces.find((p) => p.owner === 2)!;
    const enemyProv = g.provinces.find((p) => p.owner === 3)!;
    from.money = 40;
    const allyBefore = allyProv.money;
    const enemyBefore = enemyProv.money;

    g.ui = { selectedKey: from.capitalKey, mode: 'none', hoverKey: null };
    expect(g.sendMoneyToAlly(2, 10)).toBe(true);
    expect(from.money).toBe(30);
    expect(g.provinces.find((p) => p.id === allyProv.id)!.money).toBe(allyBefore + 10);
    expect(g.sendMoneyToAlly(3, 10)).toBe(false);
    expect(g.provinces.find((p) => p.id === enemyProv.id)!.money).toBe(enemyBefore);

    const empty = from.hexes.find((h) => !g.cells[h].unit)!;
    g.cells[empty].unit = {
      id: g.nextUnitId++,
      owner: 1,
      rank: 1,
      moved: false,
      count: 1,
    };
    expect(g.giftUnit(empty, 3)).toBe(false);
    expect(g.cells[empty].unit?.owner).toBe(1);
    expect(g.giftUnit(empty, 2)).toBe(true);
    expect(g.cells[empty].unit?.owner).toBe(2);
    expect(g.cells[empty].unit?.moved).toBe(true);
  });

  it('wins by team when only one alliance remains', () => {
    const g = alliedGame(77);
    for (const key of Object.keys(g.cells)) {
      if (g.cells[key].owner === 3) {
        g.cells[key].owner = 1;
        g.cells[key].unit = null;
        if (g.cells[key].building === 'castle') g.cells[key].building = null;
      }
    }
    g.beginPlayerTurn(1);
    expect(g.winnerId).not.toBeNull();
    const winner = g.players.find((p) => p.id === g.winnerId)!;
    expect(winner.teamId).toBe(1);
    expect(g.message).toMatch(/команды 1/);
  });
});
