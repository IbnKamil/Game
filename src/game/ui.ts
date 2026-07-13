import {
  HOUSE_COST,
  RECRUIT_LABEL,
  STRONG_TOWER_COST,
  TOWER_COST,
  UNIT_COST,
  UNIT_LABEL,
  DEFENSE_LABEL,
  houseRankFromKind,
  isHouseBuilding,
} from './constants';
import { calcIncome, calcUpkeep, farmCost, netIncome } from './economy';
import type { Game } from './Game';
import type { SelectionMode } from './types';

export function mountHud(root: HTMLElement): {
  root: HTMLElement;
  shell: HTMLElement;
  panel: HTMLElement;
  update: (game: Game) => void;
  setVisible: (visible: boolean) => void;
  on: (handlers: HudHandlers) => void;
} {
  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.hidden = true;
  shell.innerHTML = `
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark">⬡</span>
          <div>
            <div class="brand-name">Antiyoy Barracks</div>
            <div class="brand-sub">клон + домики призыва</div>
          </div>
        </div>
        <div class="status" id="statusLine"></div>
        <div class="top-actions">
          <button type="button" data-act="undo" title="Ctrl+Z">↩ Отмена хода</button>
          <button type="button" data-act="end" class="primary">Конец хода</button>
          <button type="button" data-act="menu">Меню</button>
        </div>
      </header>
      <div class="main">
        <div class="map-viewport" id="mapViewport">
          <div class="map-world" id="mapWorld">
            <canvas id="terrainCanvas"></canvas>
            <canvas id="overlayCanvas"></canvas>
          </div>
        </div>
        <aside class="sidebar" id="sidebar"></aside>
      </div>
      <div class="toast" id="toast" hidden></div>
      <div class="modal" id="winModal" hidden>
        <div class="modal-card">
          <h2 id="winTitle">Победа</h2>
          <button type="button" data-act="menu" class="primary">В меню</button>
        </div>
      </div>
      <div class="summon-modal" id="summonModal" hidden>
        <div class="summon-card">
          <button type="button" class="summon-close" data-act="close-summon" aria-label="Закрыть">×</button>
          <div class="summon-title" id="summonTitle">Вызов юнитов</div>
          <div class="summon-body" id="summonBody"></div>
          <div class="summon-actions" id="summonActions"></div>
        </div>
      </div>
  `;
  root.appendChild(shell);

  const panel = shell.querySelector('#sidebar') as HTMLElement;
  const handlers: HudHandlers = {};

  shell.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!t) return;
    const act = t.dataset.act!;
    if (act === 'end') handlers.endTurn?.();
    if (act === 'undo') handlers.undo?.();
    if (act === 'menu') handlers.menu?.();
    if (act === 'summon') handlers.summon?.();
    if (act === 'close-summon') handlers.closeSummon?.();
    if (act.startsWith('build:')) handlers.build?.(act.slice(6) as SelectionMode);
  });

  function update(game: Game): void {
    const status = shell.querySelector('#statusLine')!;
    const player = game.currentPlayer();
    status.innerHTML = `
      <span class="pill" style="--c:${player.color}">${player.name}</span>
      <span>Ход ${game.turn}</span>
      <span class="muted">${player.isHuman ? 'ваш ход' : 'ход ИИ'}</span>
    `;

    const toast = shell.querySelector('#toast') as HTMLElement;
    toast.hidden = !game.message;
    toast.textContent = game.message;

    const winModal = shell.querySelector('#winModal') as HTMLElement;
    const winTitle = shell.querySelector('#winTitle')!;
    if (game.winnerId) {
      winModal.hidden = false;
      const w = game.players.find((p) => p.id === game.winnerId);
      winTitle.textContent = w?.isHuman ? 'Победа!' : `${w?.name ?? 'ИИ'} победил`;
    } else {
      winModal.hidden = true;
    }

    updateSummonModal(game);

    const prov = game.selectedProvince();
    const sel = game.ui.selectedKey ? game.cells[game.ui.selectedKey] : null;
    const human = game.currentPlayer().isHuman && !game.winnerId;

    let html = `<h3>Государства</h3><ul class="players">`;
    for (const p of game.players) {
      const money = game.provinces
        .filter((pr) => pr.owner === p.id)
        .reduce((s, pr) => s + pr.money, 0);
      html += `<li class="${p.alive ? '' : 'dead'} ${p.id === game.currentPlayerId ? 'active' : ''}">
        <span class="dot" style="background:${p.color}"></span>
        ${p.name}
        <span class="muted">${p.alive ? money + '🪙' : '✕'}${p.isHuman ? '' : ' · ИИ'}</span>
      </li>`;
    }
    html += `</ul>`;

    if (prov && prov.owner === game.currentPlayerId) {
      const income = calcIncome(game.cells, prov);
      const upkeep = calcUpkeep(game.cells, prov);
      const net = netIncome(game.cells, prov);
      html += `
        <h3>Провинция</h3>
        <div class="stat-grid">
          <div><span>Монеты</span><b>${prov.money}</b></div>
          <div><span>Доход</span><b>${income}</b></div>
          <div><span>Содержание</span><b>${upkeep}</b></div>
          <div><span>Итого</span><b class="${net < 0 ? 'bad' : 'good'}">${net >= 0 ? '+' : ''}${net}</b></div>
          <div><span>Гексов</span><b>${prov.hexes.length}</b></div>
        </div>
      `;

      if (human) {
        const fc = farmCost(game.cells, prov);
        html += `<h3>Постройки</h3><div class="btn-grid">`;
        html += btn('build:buildFarm', `[1] Ферма (${fc})`, prov.money >= fc);
        html += buildIconBtn(
          'build:buildTower',
          `/firepoint-icon.png`,
          `[2] ${DEFENSE_LABEL.tower}`,
          TOWER_COST,
          prov.money >= TOWER_COST,
        );
        html += buildIconBtn(
          'build:buildStrongTower',
          `/defense-line-icon.png`,
          `[3] ${DEFENSE_LABEL.strongTower}`,
          STRONG_TOWER_COST,
          prov.money >= STRONG_TOWER_COST,
        );
        html += `</div><h3>Здания призыва</h3><div class="btn-grid">`;
        for (const r of [1, 2, 3, 4] as const) {
          html += btn(
            `build:buildHouse${r}`,
            `[${r + 3}] ${RECRUIT_LABEL[r]} (${HOUSE_COST[r]})`,
            prov.money >= HOUSE_COST[r],
          );
        }
        html += `</div>`;
        html += `<p class="hint">Клавиши 1–7 — постройки. «ё» / Enter — конец хода. Клик по зданию призыва открывает вызов (юнит ×1 через N ходов).</p>`;
      }
    } else {
      html += `<p class="hint">Выберите свою провинцию на карте.</p>`;
    }

    if (sel?.unit) {
      const label = UNIT_LABEL[sel.unit.rank];
      const n = sel.unit.count ?? 1;
      html += `<h3>${label} ×${n}</h3><p>Ранг ${sel.unit.rank}${sel.unit.moved ? ' (уже ходили)' : ''}. Свои того же ранга — объединение. Атака равных — если ваш × больше.</p>`;
    }

    html += `
      <h3>Юниты</h3>
      <ul class="rules">
        <li>1 — ополченец (охотник), стак ×N</li>
        <li>2 — солдат, стак ×N</li>
        <li>3 — спецназ (+машина)</li>
        <li>4 — танк</li>
        <li>На карте до 5 фигурок; × может быть больше</li>
        <li>Равный ранг: атака если ваш × выше, теряете × врага</li>
        <li>Выше рангом — уничтожает без потерь</li>
      </ul>
      <h3>Правила кратко</h3>
      <ul class="rules">
        <li>Доход с гексов и ферм; юниты едят монеты.</li>
        <li>Захват: ранг юнита &gt; защиты клетки.</li>
        <li>Объединение юнитов отключено.</li>
        <li>По своей территории ход до 2 клеток.</li>
        <li>Вызов только из зданий призыва.</li>
      </ul>
    `;

    panel.innerHTML = html;
  }

  function updateSummonModal(game: Game): void {
    const modal = shell.querySelector('#summonModal') as HTMLElement;
    const title = shell.querySelector('#summonTitle')!;
    const body = shell.querySelector('#summonBody')!;
    const actions = shell.querySelector('#summonActions')!;

    const key = game.ui.selectedKey;
    const cell = key ? game.cells[key] : null;
    const show =
      !!cell &&
      game.ui.mode === 'house' &&
      isHouseBuilding(cell.building) &&
      cell.owner === game.currentPlayerId &&
      !game.winnerId;

    if (!show) {
      modal.hidden = true;
      return;
    }

    const rank = houseRankFromKind(cell!.building!)!;
    const prov = game.getProvince(key!);
    const human = game.currentPlayer().isHuman;
    const name = RECRUIT_LABEL[rank];
    const unitName = UNIT_LABEL[rank];
    const cost = UNIT_COST[rank];

    modal.hidden = false;
    title.textContent = name;

    if (cell!.training) {
      body.innerHTML = `
        <p class="summon-unit">${UNIT_LABEL[cell!.training.rank]}</p>
        <p>Идёт обучение. Осталось ходов: <b>${cell!.training.turnsLeft}</b>.</p>
        <p class="hint">Юнит появится на соседней свободной клетке.</p>
      `;
      actions.innerHTML = `<button type="button" data-act="close-summon">Закрыть</button>`;
    } else {
      body.innerHTML = `
        <p class="summon-unit">${unitName}</p>
        <div class="summon-stats">
          <div><span>Стоимость</span><b>${cost}🪙</b></div>
          <div><span>Время</span><b>${rank} ход(а)</b></div>
          <div><span>Монеты провинции</span><b>${prov?.money ?? 0}🪙</b></div>
        </div>
        <p class="hint">После оплаты юнит появится рядом со зданием через ${rank} ваш(их) ход(а).</p>
      `;
      const can = human && (prov?.money ?? 0) >= cost;
      actions.innerHTML = `
        <button type="button" class="primary" data-act="summon" ${can ? '' : 'disabled'}>
          Вызвать: ${unitName}
        </button>
        <button type="button" data-act="close-summon">Отмена</button>
      `;
    }
  }

  return {
    root,
    shell,
    panel,
    update,
    setVisible(visible: boolean) {
      shell.hidden = !visible;
    },
    on(h) {
      Object.assign(handlers, h);
    },
  };
}

function btn(act: string, label: string, enabled: boolean): string {
  return `<button type="button" data-act="${act}" ${enabled ? '' : 'disabled'}>${label}</button>`;
}

function buildIconBtn(
  act: string,
  iconSrc: string,
  label: string,
  cost: number,
  enabled: boolean,
): string {
  return `<button type="button" class="build-icon-btn" data-act="${act}" ${enabled ? '' : 'disabled'}>
    <img src="${iconSrc}" alt="" width="28" height="28" />
    <span>${label} (${cost})</span>
  </button>`;
}

interface HudHandlers {
  endTurn?: () => void;
  undo?: () => void;
  menu?: () => void;
  summon?: () => void;
  closeSummon?: () => void;
  build?: (mode: SelectionMode) => void;
}
