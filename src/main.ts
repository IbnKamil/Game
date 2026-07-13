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
  preloadUnitSprites(() => render());
  scheduleAi();
}

function backToMenu(): void {
  stopAi();
  game = null;
  hud.setVisible(false);
  menu.show();
}

function render(): void {
  if (!game || !renderer) return;
  renderer.draw(game);
  hud.update(game);
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
  // Cancel any previous AI loop, then claim this run's epoch
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
    const thinkMs = diff === 'easy' ? 280 : diff === 'expert' ? 80 : 160;
    const playerId = game.currentPlayerId;

    const still = await delay(thinkMs, epoch);
    if (!still || !game || game.winnerId) return;
    if (game.currentPlayerId !== playerId) continue;

    try {
      runAiTurn(game, playerId);
    } catch (err) {
      console.error('AI turn failed', err);
    }
    // Canvas only during AI to keep UI responsive
    if (renderer && game) renderer.draw(game);

    const ok = await delay(40, epoch);
    if (!ok || !game || game.winnerId) return;
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

function scheduleHoverDraw(): void {
  if (hoverRaf) return;
  hoverRaf = window.requestAnimationFrame(() => {
    hoverRaf = 0;
    if (game && renderer) renderer.draw(game);
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
    render();
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
      renderer.zoomAt(sx, sy, factor);
      render();
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
    renderer?.zoomAt(renderer.canvas.clientWidth / 2, renderer.canvas.clientHeight / 2, 1.12);
    render();
  }
  if (e.key === '-' || e.key === '_') {
    renderer?.zoomAt(renderer.canvas.clientWidth / 2, renderer.canvas.clientHeight / 2, 1 / 1.12);
    render();
  }
});

menu.show();
