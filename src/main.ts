import '@fontsource/outfit/400.css';
import '@fontsource/outfit/600.css';
import '@fontsource/outfit/700.css';
import '@fontsource/source-serif-4/600.css';
import '@fontsource/source-serif-4/700.css';
import './style.css';
import { runAiTurn } from './game/ai';
import { Game } from './game/Game';
import { defaultMenuState, mountMenu } from './game/menu';
import { Renderer } from './game/renderer';
import { preloadUnitSprites } from './game/sprites';
import type { GameConfig, SelectionMode } from './game/types';
import { cellKey } from './game/types';
import { mountHud } from './game/ui';

const app = document.querySelector<HTMLDivElement>('#app')!;
const menuState = defaultMenuState();
const hud = mountHud(app);

let game: Game | null = null;
let renderer: Renderer | null = null;
let viewport: HTMLElement | null = null;
let aiEpoch = 0;
const aiTimers = new Set<number>();

const menu = mountMenu(app, menuState, (config) => {
  startGame(config);
});

function startGame(config: GameConfig): void {
  stopAi();
  menu.hide();
  hud.setVisible(true);
  game = new Game(config);
  game.saveTurnCheckpoint();
  viewport = document.querySelector('#mapViewport');
  if (!viewport) return;
  renderer = new Renderer(viewport);
  bindViewport(viewport);
  renderer.centerOnMap(game);
  render();
  preloadUnitSprites(() => {
    renderer?.invalidateMapCache();
    paint();
  });
  scheduleAi();
}

function backToMenu(): void {
  stopAi();
  game = null;
  hud.setVisible(false);
  menu.show();
}

function paint(): void {
  if (!game || !renderer) return;
  renderer.draw(game);
}

function paintOverlay(): void {
  if (!game || !renderer) return;
  renderer.drawOverlay(game);
}

function render(): void {
  paint();
  if (game) hud.update(game);
}

function stopAi(): void {
  aiEpoch += 1;
  for (const id of aiTimers) window.clearTimeout(id);
  aiTimers.clear();
}

function delay(ms: number, epoch: number): Promise<boolean> {
  return new Promise((resolve) => {
    const id = window.setTimeout(() => {
      aiTimers.delete(id);
      resolve(epoch === aiEpoch);
    }, ms);
    aiTimers.add(id);
  });
}

async function scheduleAi(): Promise<void> {
  for (const id of aiTimers) window.clearTimeout(id);
  aiTimers.clear();
  const epoch = ++aiEpoch;
  if (!game || game.winnerId) return;

  while (game && !game.winnerId && epoch === aiEpoch) {
    const player = game.currentPlayer();
    if (!player || player.isHuman) return;
    if (!player.alive) {
      game.endTurn();
      render();
      continue;
    }

    const playerId = game.currentPlayerId;
    const still = await delay(16, epoch);
    if (!still || !game || game.winnerId) return;
    if (game.currentPlayerId !== playerId) continue;

    try {
      runAiTurn(game, playerId);
    } catch (err) {
      console.error('AI turn failed', err);
    }
    paint();
    await delay(0, epoch);
    if (!game || game.winnerId || epoch !== aiEpoch) return;
    if (game.currentPlayerId !== playerId) continue;
    game.endTurn();
    render();
  }
}

function endTurnFlow(): void {
  if (!game || !game.currentPlayer().isHuman || game.winnerId) return;
  game.endTurn();
  render();
  void scheduleAi();
}

hud.on({
  endTurn: endTurnFlow,
  undo: () => {
    if (!game?.currentPlayer().isHuman) return;
    game.undo();
    renderer?.invalidateMapCache();
    render();
  },
  menu: backToMenu,
  summon: () => {
    game?.summonFromHouse();
    render();
  },
  closeSummon: () => {
    game?.clearSelection();
    paintOverlay();
    hud.update(game!);
  },
  build: (mode: SelectionMode) => {
    game?.setBuildMode(mode);
    paintOverlay();
    hud.update(game!);
  },
});

let bound = false;
let panning = false;
let panButton = -1;
let panLastX = 0;
let panLastY = 0;
let panMoved = false;
let overlayRaf = 0;
let hudRaf = 0;

function scheduleOverlay(): void {
  if (overlayRaf) return;
  overlayRaf = window.requestAnimationFrame(() => {
    overlayRaf = 0;
    paintOverlay();
  });
}

function scheduleHud(): void {
  if (hudRaf) return;
  hudRaf = window.requestAnimationFrame(() => {
    hudRaf = 0;
    if (game) hud.update(game);
  });
}

function bindViewport(vp: HTMLElement): void {
  if (bound) return;
  bound = true;

  vp.addEventListener('auxclick', (e) => {
    if (e.button === 1) e.preventDefault();
  });

  vp.addEventListener('mousedown', (e) => {
    if (!game || !renderer || hud.shell.hidden) return;
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      panning = true;
      panButton = e.button;
      panMoved = false;
      panLastX = e.clientX;
      panLastY = e.clientY;
      vp.style.cursor = 'grabbing';
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!panning || !renderer) return;
    const dx = e.clientX - panLastX;
    const dy = e.clientY - panLastY;
    if (dx === 0 && dy === 0) return;
    panMoved = true;
    renderer.panBy(dx, dy); // CSS only
    panLastX = e.clientX;
    panLastY = e.clientY;
  });

  window.addEventListener('mouseup', (e) => {
    if (panning && e.button === panButton) {
      panning = false;
      panButton = -1;
      if (viewport) viewport.style.cursor = 'crosshair';
    }
  });

  vp.addEventListener('contextmenu', (e) => {
    if (!hud.shell.hidden) e.preventDefault();
  });

  vp.addEventListener('click', (e) => {
    if (!game || !renderer || !game.currentPlayer().isHuman || game.winnerId) return;
    if (panMoved) {
      panMoved = false;
      return;
    }
    if (e.altKey) return;
    const rect = vp.getBoundingClientRect();
    const { q, r } = renderer.screenToHex(e.clientX - rect.left, e.clientY - rect.top);
    const key = cellKey(q, r);
    if (!game.cells[key]) game.clearSelection();
    else game.selectHex(key);
    paint(); // terrain only if revision changed; overlay always
    scheduleHud();
  });

  vp.addEventListener('mousemove', (e) => {
    if (!game || !renderer || panning) return;
    const rect = vp.getBoundingClientRect();
    const { q, r } = renderer.screenToHex(e.clientX - rect.left, e.clientY - rect.top);
    const key = cellKey(q, r);
    const next = game.cells[key] ? key : null;
    if (next !== game.ui.hoverKey) {
      game.ui.hoverKey = next;
      scheduleOverlay();
    }
  });

  vp.addEventListener(
    'wheel',
    (e) => {
      if (!game || !renderer || hud.shell.hidden) return;
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      renderer.zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor); // CSS only
    },
    { passive: false },
  );
}

window.addEventListener('resize', () => {
  if (!game || !renderer) return;
  renderer.centerOnMap(game);
  render();
});

window.addEventListener('keydown', (e) => {
  if (!game || hud.shell.hidden) return;
  if (e.repeat) return;
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'ё' || e.key === 'Ё' || e.key === '`') {
    e.preventDefault();
    endTurnFlow();
  }
  if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (!game.currentPlayer().isHuman) return;
    game.undo();
    renderer?.invalidateMapCache();
    render();
  }
  if (e.key === 'Escape') {
    game.clearSelection();
    paintOverlay();
    scheduleHud();
  }
  if (e.key === '+' || e.key === '=') {
    renderer?.zoomAt((viewport?.clientWidth ?? 0) / 2, (viewport?.clientHeight ?? 0) / 2, 1.1);
  }
  if (e.key === '-' || e.key === '_') {
    renderer?.zoomAt((viewport?.clientWidth ?? 0) / 2, (viewport?.clientHeight ?? 0) / 2, 1 / 1.1);
  }

  // Building hotkeys (require selected own province — setBuildMode checks)
  if (game.currentPlayer().isHuman && !game.winnerId) {
    const buildHotkeys: Record<string, SelectionMode> = {
      '1': 'buildFarm',
      '2': 'buildTower',
      '3': 'buildStrongTower',
      '4': 'buildHouse1',
      '5': 'buildHouse2',
      '6': 'buildHouse3',
      '7': 'buildHouse4',
    };
    const mode = buildHotkeys[e.key];
    if (mode) {
      e.preventDefault();
      game.setBuildMode(mode);
      paintOverlay();
      scheduleHud();
    }
  }
});

menu.show();
