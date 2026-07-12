import './style.css';
import { runAiTurn } from './game/ai';
import { Game } from './game/Game';
import { Renderer } from './game/renderer';
import type { GameConfig, SelectionMode } from './game/types';
import { cellKey } from './game/types';
import { mountHud } from './game/ui';

const app = document.querySelector<HTMLDivElement>('#app')!;
const hud = mountHud(app);
const canvas = document.querySelector<HTMLCanvasElement>('#gameCanvas')!;
const renderer = new Renderer(canvas);

let game = createGame();
let aiTimer: number | null = null;

function createGame(): Game {
  const config: GameConfig = {
    mapRadius: 9,
    playerCount: 4,
    humanPlayerId: 1,
    seed: (Math.random() * 1e9) | 0,
  };
  return new Game(config);
}

function render(): void {
  renderer.draw(game);
  hud.update(game);
}

function scheduleAi(): void {
  if (aiTimer !== null) {
    window.clearTimeout(aiTimer);
    aiTimer = null;
  }
  if (game.winnerId) return;
  if (game.currentPlayer().isHuman) return;

  aiTimer = window.setTimeout(() => {
    runAiTurn(game, game.currentPlayerId);
    render();
    window.setTimeout(() => {
      if (!game.winnerId && !game.currentPlayer().isHuman) {
        // still AI somehow — shouldn't happen
      }
      game.endTurn();
      render();
      scheduleAi();
    }, 280);
  }, 420);
}

function endTurnFlow(): void {
  if (!game.currentPlayer().isHuman || game.winnerId) return;
  game.endTurn();
  render();
  scheduleAi();
}

hud.on({
  endTurn: endTurnFlow,
  undo: () => {
    if (!game.currentPlayer().isHuman) return;
    game.undo();
    render();
  },
  newGame: () => {
    game = createGame();
    renderer.centerOnMap(game);
    render();
    scheduleAi();
  },
  summon: () => {
    game.summonFromHouse();
    render();
  },
  build: (mode: SelectionMode) => {
    game.setBuildMode(mode);
    render();
  },
});

canvas.addEventListener('click', (e) => {
  if (!game.currentPlayer().isHuman || game.winnerId) return;
  const rect = canvas.getBoundingClientRect();
  const { q, r } = renderer.screenToHex(e.clientX - rect.left, e.clientY - rect.top);
  const key = cellKey(q, r);
  if (!game.cells[key]) {
    game.clearSelection();
  } else {
    game.selectHex(key);
  }
  render();
});

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const { q, r } = renderer.screenToHex(e.clientX - rect.left, e.clientY - rect.top);
  const key = cellKey(q, r);
  const next = game.cells[key] ? key : null;
  if (next !== game.ui.hoverKey) {
    game.ui.hoverKey = next;
    renderer.draw(game);
  }
});

window.addEventListener('resize', () => {
  renderer.resize();
  renderer.centerOnMap(game);
  render();
});

window.addEventListener('keydown', (e) => {
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
});

renderer.resize();
renderer.centerOnMap(game);
render();
scheduleAi();
