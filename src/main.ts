import './style.css';
import { runAiTurn } from './game/ai';
import { Game } from './game/Game';
import { defaultMenuState, mountMenu } from './game/menu';
import { Renderer } from './game/renderer';
import type { GameConfig, SelectionMode } from './game/types';
import { cellKey } from './game/types';
import { mountHud } from './game/ui';

const app = document.querySelector<HTMLDivElement>('#app')!;
const menuState = defaultMenuState();
const hud = mountHud(app);

let game: Game | null = null;
let renderer: Renderer | null = null;
let aiTimer: number | null = null;
let canvas: HTMLCanvasElement | null = null;

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
  if (aiTimer !== null) {
    window.clearTimeout(aiTimer);
    aiTimer = null;
  }
}

function scheduleAi(): void {
  stopAi();
  if (!game || game.winnerId) return;
  if (game.currentPlayer().isHuman) return;

  const diff = game.config.aiDifficulty ?? 'normal';
  const thinkMs = diff === 'easy' ? 520 : diff === 'expert' ? 220 : 380;

  aiTimer = window.setTimeout(() => {
    if (!game) return;
    runAiTurn(game, game.currentPlayerId);
    render();
    window.setTimeout(() => {
      if (!game || game.winnerId) return;
      game.endTurn();
      render();
      scheduleAi();
    }, 220);
  }, thinkMs);
}

function endTurnFlow(): void {
  if (!game || !game.currentPlayer().isHuman || game.winnerId) return;
  game.endTurn();
  render();
  scheduleAi();
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
  build: (mode: SelectionMode) => {
    game?.setBuildMode(mode);
    render();
  },
});

let canvasBound = false;
function bindCanvas(c: HTMLCanvasElement): void {
  if (canvasBound) return;
  canvasBound = true;

  c.addEventListener('click', (e) => {
    if (!game || !renderer || !game.currentPlayer().isHuman || game.winnerId) return;
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
    if (!game || !renderer) return;
    const rect = c.getBoundingClientRect();
    const { q, r } = renderer.screenToHex(e.clientX - rect.left, e.clientY - rect.top);
    const key = cellKey(q, r);
    const next = game.cells[key] ? key : null;
    if (next !== game.ui.hoverKey) {
      game.ui.hoverKey = next;
      renderer.draw(game);
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
}

window.addEventListener('resize', () => {
  if (!game || !renderer) return;
  renderer.resize();
  renderer.centerOnMap(game);
  render();
});

window.addEventListener('keydown', (e) => {
  if (!game || hud.shell.hidden) return;
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
