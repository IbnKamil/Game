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
let canvas: HTMLCanvasElement | null = null;
/** Cancels in-flight AI timeouts when incremented. */
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
  canvas = document.querySelector<HTMLCanvasElement>('#gameCanvas');
  if (!canvas) return;
  renderer = new Renderer(canvas);
  bindCanvas(canvas);
  renderer.resize();
  renderer.centerOnMap(game);
  render();
  preloadUnitSprites(() => paint());
  scheduleAi();
}

function backToMenu(): void {
  stopAi();
  game = null;
  hud.setVisible(false);
  menu.show();
}

/** Canvas only — used for hover / pan / zoom. */
function paint(): void {
  if (!game || !renderer) return;
  renderer.draw(game);
}

/** Canvas + sidebar — used after game actions. */
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

function yieldFrame(epoch: number): Promise<boolean> {
  return new Promise((resolve) => {
    const id = window.requestAnimationFrame(() => {
      resolve(epoch === aiEpoch);
    });
    // Track as timeout-like cancel via epoch only
    void id;
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

    const diff = game.config.aiDifficulty ?? 'normal';
    // Tiny pause so the UI can paint "AI thinking" — not hundreds of ms
    const thinkMs = diff === 'easy' ? 40 : diff === 'expert' ? 0 : 16;
    const playerId = game.currentPlayerId;

    if (thinkMs > 0) {
      const still = await delay(thinkMs, epoch);
      if (!still || !game || game.winnerId) return;
      if (game.currentPlayerId !== playerId) continue;
    }

    try {
      runAiTurn(game, playerId);
    } catch (err) {
      console.error('AI turn failed', err);
    }
    paint();
    const okFrame = await yieldFrame(epoch);
    if (!okFrame || !game || game.winnerId) return;
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
    render();
  },
  menu: backToMenu,
  summon: () => {
    game?.summonFromHouse();
    render();
  },
  closeSummon: () => {
    game?.clearSelection();
    render();
  },
  build: (mode: SelectionMode) => {
    game?.setBuildMode(mode);
    render();
  },
});

let canvasBound = false;
let panning = false;
let panLastX = 0;
let panLastY = 0;
let panMoved = false;
let hoverRaf = 0;
let zoomRaf = 0;
let settleTimer = 0;
let pendingZoom: { sx: number; sy: number; factor: number } | null = null;

function setFastMode(on: boolean): void {
  if (!renderer) return;
  if (renderer.fastMode === on) return;
  renderer.fastMode = on;
  renderer.resize();
}

function settleDetailedPaint(): void {
  window.clearTimeout(settleTimer);
  settleTimer = window.setTimeout(() => {
    setFastMode(false);
    paint();
  }, 120);
}

function scheduleHoverDraw(): void {
  if (hoverRaf) return;
  hoverRaf = window.requestAnimationFrame(() => {
    hoverRaf = 0;
    paint();
  });
}

function scheduleZoomDraw(): void {
  setFastMode(true);
  if (zoomRaf) return;
  zoomRaf = window.requestAnimationFrame(() => {
    zoomRaf = 0;
    if (pendingZoom && renderer) {
      renderer.zoomAt(pendingZoom.sx, pendingZoom.sy, pendingZoom.factor);
      pendingZoom = null;
    }
    paint();
    settleDetailedPaint();
  });
}

function bindCanvas(c: HTMLCanvasElement): void {
  if (canvasBound) return;
  canvasBound = true;

  c.addEventListener('auxclick', (e) => {
    if (e.button === 1) e.preventDefault();
  });

  c.addEventListener('mousedown', (e) => {
    if (!game || !renderer || hud.shell.hidden) return;
    if (e.button === 1) {
      e.preventDefault();
      panning = true;
      panMoved = false;
      panLastX = e.clientX;
      panLastY = e.clientY;
      setFastMode(true);
      c.style.cursor = 'grabbing';
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!panning || !renderer || !game) return;
    const dx = e.clientX - panLastX;
    const dy = e.clientY - panLastY;
    if (dx !== 0 || dy !== 0) {
      panMoved = true;
      renderer.panBy(dx, dy);
      panLastX = e.clientX;
      panLastY = e.clientY;
      scheduleHoverDraw();
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button === 1 && panning) {
      panning = false;
      if (canvas) canvas.style.cursor = 'crosshair';
      settleDetailedPaint();
    }
  });

  c.addEventListener('click', (e) => {
    if (!game || !renderer || !game.currentPlayer().isHuman || game.winnerId) return;
    if (panMoved) {
      panMoved = false;
      return;
    }
    const rect = c.getBoundingClientRect();
    const { q, r } = renderer.screenToHex(e.clientX - rect.left, e.clientY - rect.top);
    const key = cellKey(q, r);
    if (!game.cells[key]) {
      game.clearSelection();
    } else {
      game.selectHex(key);
    }
    // Paint first, HUD on next frame — keeps clicks snappy
    paint();
    window.requestAnimationFrame(() => {
      if (game) hud.update(game);
    });
  });

  c.addEventListener('mousemove', (e) => {
    if (!game || !renderer || panning) return;
    const rect = c.getBoundingClientRect();
    const { q, r } = renderer.screenToHex(e.clientX - rect.left, e.clientY - rect.top);
    const key = cellKey(q, r);
    const next = game.cells[key] ? key : null;
    if (next !== game.ui.hoverKey) {
      game.ui.hoverKey = next;
      scheduleHoverDraw();
    }
  });

  c.addEventListener(
    'wheel',
    (e) => {
      if (!game || !renderer || hud.shell.hidden) return;
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      if (pendingZoom) {
        pendingZoom.factor *= factor;
        pendingZoom.sx = sx;
        pendingZoom.sy = sy;
      } else {
        pendingZoom = { sx, sy, factor };
      }
      scheduleZoomDraw();
    },
    { passive: false },
  );

  c.addEventListener('mousedown', (e) => {
    if (e.button === 1) e.preventDefault();
  });
}

window.addEventListener('resize', () => {
  if (!game || !renderer) return;
  renderer.resize();
  renderer.centerOnMap(game);
  render();
});

window.addEventListener('keydown', (e) => {
  if (!game || hud.shell.hidden) return;
  if (e.repeat) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    endTurnFlow();
  }
  if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    game.undo();
    render();
  }
  if (e.key === 'Escape') {
    game.clearSelection();
    render();
  }
  if (e.key === '+' || e.key === '=') {
    setFastMode(true);
    renderer?.zoomAt(renderer.canvas.clientWidth / 2, renderer.canvas.clientHeight / 2, 1.12);
    paint();
    settleDetailedPaint();
  }
  if (e.key === '-' || e.key === '_') {
    setFastMode(true);
    renderer?.zoomAt(renderer.canvas.clientWidth / 2, renderer.canvas.clientHeight / 2, 1 / 1.12);
    paint();
    settleDetailedPaint();
  }
});

menu.show();
