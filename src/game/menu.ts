import {
  AI_DIFFICULTY_PRESETS,
  DEFAULT_FOREST_DENSITY,
  DEFAULT_NATION_NAMES,
  FOREST_DENSITY_MAX,
  FOREST_DENSITY_MIN,
  MAP_SIZE_PRESETS,
  PLAYER_COLORS,
  clampForestDensity,
  defaultPlayerSetup,
  mapRadiusFromSize,
  type AiDifficultyId,
  type MapSizeId,
} from './constants';
import { drawUnitFigurine, preloadUnitSprites } from './sprites';
import type { AiDifficulty, GameConfig, PlayerSetup } from './types';

export interface MenuState {
  playerCount: number;
  humanCount: number;
  mapSize: MapSizeId;
  aiDifficulty: AiDifficultyId;
  /** Target forest coverage 0–100%. */
  forestDensity: number;
  players: PlayerSetup[];
}

export function defaultMenuState(): MenuState {
  const playerCount = 4;
  const humanCount = 1;
  return {
    playerCount,
    humanCount,
    mapSize: 'medium',
    aiDifficulty: 'normal',
    forestDensity: DEFAULT_FOREST_DENSITY,
    players: Array.from({ length: playerCount }, (_, i) =>
      defaultPlayerSetup(i, i < humanCount),
    ),
  };
}

export function syncPlayers(state: MenuState): void {
  const next: PlayerSetup[] = [];
  for (let i = 0; i < state.playerCount; i++) {
    const prev = state.players[i];
    if (prev) {
      next.push({
        ...prev,
        isHuman: i < state.humanCount,
        teamId: prev.teamId || i + 1,
      });
    } else {
      next.push(defaultPlayerSetup(i, i < state.humanCount));
    }
  }
  for (let i = 0; i < next.length; i++) {
    next[i].isHuman = i < state.humanCount;
    if (!next[i].teamId) next[i].teamId = i + 1;
    // Clamp team id to available player slots
    if (next[i].teamId < 1) next[i].teamId = 1;
    if (next[i].teamId > state.playerCount) next[i].teamId = state.playerCount;
  }
  state.players = next;
}

export function menuToConfig(state: MenuState): GameConfig {
  syncPlayers(state);
  return {
    mapRadius: mapRadiusFromSize(state.mapSize),
    playerCount: state.playerCount,
    seed: (Math.random() * 1e9) | 0,
    players: state.players.map((p) => ({ ...p })),
    aiDifficulty: state.aiDifficulty as AiDifficulty,
    forestDensity: clampForestDensity(state.forestDensity ?? DEFAULT_FOREST_DENSITY),
  };
}

export function mountMenu(
  root: HTMLElement,
  initial: MenuState,
  onStart: (config: GameConfig) => void,
): { show: () => void; hide: () => void; getState: () => MenuState } {
  const state: MenuState = structuredClone(initial);
  syncPlayers(state);

  const el = document.createElement('div');
  el.className = 'menu-screen';
  el.id = 'startMenu';
  root.appendChild(el);

  function render(): void {
    syncPlayers(state);
    const diffHint =
      AI_DIFFICULTY_PRESETS.find((d) => d.id === state.aiDifficulty)?.hint ?? '';
    el.innerHTML = `
      <div class="menu-card">
        <div class="menu-hero">
          <div class="menu-brand">Antiyoy Barracks</div>
          <p class="menu-lead">Настройте войну государств и начните партию</p>
        </div>

        <div class="menu-grid">
          <label class="field">
            <span>Всего игроков</span>
            <input type="range" min="2" max="8" value="${state.playerCount}" data-field="playerCount" />
            <b>${state.playerCount}</b>
          </label>
          <label class="field">
            <span>Игроков (не ИИ)</span>
            <input type="range" min="1" max="${state.playerCount}" value="${state.humanCount}" data-field="humanCount" />
            <b>${state.humanCount}</b>
          </label>
          <label class="field field-wide">
            <span>Размер карты</span>
            <div class="seg">
              ${MAP_SIZE_PRESETS.map(
                (p) => `
                <button type="button" class="seg-btn ${state.mapSize === p.id ? 'active' : ''}" data-map="${p.id}">
                  ${p.label}
                </button>`,
              ).join('')}
            </div>
          </label>
          <label class="field field-wide">
            <span>Лесистость карты</span>
            <input
              type="range"
              min="${FOREST_DENSITY_MIN}"
              max="${FOREST_DENSITY_MAX}"
              step="5"
              value="${clampForestDensity(state.forestDensity)}"
              data-field="forestDensity"
            />
            <b>${clampForestDensity(state.forestDensity)}%</b>
            <em class="field-hint">Доля клеток с деревьями при генерации карты</em>
          </label>
          <label class="field field-wide">
            <span>Сложность ИИ</span>
            <div class="seg">
              ${AI_DIFFICULTY_PRESETS.map(
                (d) => `
                <button type="button" class="seg-btn ${state.aiDifficulty === d.id ? 'active' : ''}" data-diff="${d.id}">
                  ${d.label}
                </button>`,
              ).join('')}
            </div>
            <em class="field-hint">${diffHint}</em>
          </label>
        </div>

        <h3 class="menu-section">Государства</h3>
        <div class="nation-list">
          ${state.players
            .map(
              (p, i) => `
            <div class="nation-row" style="--c:${p.color}">
              <span class="nation-idx">${i + 1}</span>
              <input type="text" maxlength="28" value="${escapeAttr(p.name)}" data-name="${i}" aria-label="Название государства ${i + 1}" />
              <input type="color" value="${toColorInput(p.color)}" data-color="${i}" aria-label="Цвет ${i + 1}" />
              <label class="nation-team">
                <span>Команда</span>
                <select data-team="${i}" aria-label="Команда ${i + 1}">
                  ${Array.from({ length: state.playerCount }, (_, t) => {
                    const tid = t + 1;
                    return `<option value="${tid}" ${p.teamId === tid ? 'selected' : ''}>${tid}</option>`;
                  }).join('')}
                </select>
              </label>
              <span class="nation-role">${p.isHuman ? 'Игрок' : 'ИИ'}</span>
            </div>`,
            )
            .join('')}
        </div>
        <em class="field-hint">Одинаковый номер команды — союзники: ходят по земле друг друга, могут переводить монеты и юнитов. Победа засчитывается всей команде.</em>

        <div class="menu-legend">
          <div class="legend-item"><canvas data-preview="unit1" width="110" height="56"></canvas><span>1 — ополченец (охотник) ×1, стак до ×N</span></div>
          <div class="legend-item"><canvas data-preview="unit2" width="120" height="60"></canvas><span>2 — солдат ×1, стак до ×N</span></div>
          <div class="legend-item"><canvas data-preview="unit3" width="120" height="60"></canvas><span>3 — спецназ ×1 (+машина)</span></div>
          <div class="legend-item"><canvas data-preview="unit4" width="120" height="60"></canvas><span>4 — танк ×1</span></div>
        </div>

        <button type="button" class="primary menu-start" data-act="start">Начать игру</button>
      </div>
    `;

    paintPreviews(el);

    el.querySelectorAll<HTMLInputElement>('[data-field]').forEach((input) => {
      input.addEventListener('input', () => {
        const field = input.dataset.field!;
        const value = Number(input.value);
        if (field === 'playerCount') {
          state.playerCount = value;
          if (state.humanCount > value) state.humanCount = value;
          render();
          return;
        }
        if (field === 'humanCount') {
          state.humanCount = value;
          render();
          return;
        }
        if (field === 'forestDensity') {
          state.forestDensity = clampForestDensity(value);
          const label = input.parentElement?.querySelector('b');
          if (label) label.textContent = `${state.forestDensity}%`;
        }
      });
    });

    el.querySelectorAll<HTMLButtonElement>('[data-map]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.mapSize = btn.dataset.map as MapSizeId;
        render();
      });
    });

    el.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.aiDifficulty = btn.dataset.diff as AiDifficultyId;
        render();
      });
    });

    el.querySelectorAll<HTMLInputElement>('[data-name]').forEach((input) => {
      input.addEventListener('change', () => {
        const i = Number(input.dataset.name);
        state.players[i].name = input.value.trim() || DEFAULT_NATION_NAMES[i];
      });
      input.addEventListener('input', () => {
        const i = Number(input.dataset.name);
        state.players[i].name = input.value;
      });
    });

    el.querySelectorAll<HTMLInputElement>('[data-color]').forEach((input) => {
      input.addEventListener('input', () => {
        const i = Number(input.dataset.color);
        state.players[i].color = input.value;
        const row = input.closest('.nation-row') as HTMLElement;
        row.style.setProperty('--c', input.value);
      });
    });

    el.querySelectorAll<HTMLSelectElement>('[data-team]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const i = Number(sel.dataset.team);
        state.players[i].teamId = Number(sel.value) || i + 1;
      });
    });

    el.querySelector('[data-act="start"]')?.addEventListener('click', () => {
      el.querySelectorAll<HTMLInputElement>('[data-name]').forEach((input) => {
        const i = Number(input.dataset.name);
        state.players[i].name = input.value.trim() || DEFAULT_NATION_NAMES[i];
      });
      onStart(menuToConfig(state));
    });
  }

  function show(): void {
    el.hidden = false;
    render();
  }

  function hide(): void {
    el.hidden = true;
  }

  render();
  return {
    show,
    hide,
    getState: () => structuredClone(state),
  };
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function toColorInput(color: string): string {
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) {
    if (color.length === 4) {
      return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
    }
    return color;
  }
  return PLAYER_COLORS[0];
}

function paintPreviews(root: HTMLElement): void {
  const color = '#2f9e44';
  const paint = (): void => {
    for (const rank of [1, 2, 3, 4] as const) {
      const canvas = root.querySelector<HTMLCanvasElement>(`[data-preview="unit${rank}"]`);
      if (!canvas) continue;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawUnitFigurine(ctx, canvas.width / 2, canvas.height / 2 + 8, rank, false, color, { count: 1 });
    }
  };
  paint();
  preloadUnitSprites(paint);
}
