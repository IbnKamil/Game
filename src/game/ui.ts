import {
  HOUSE_COST,
  STRONG_TOWER_COST,
  TOWER_COST,
  UNIT_COST,
  UNIT_LABEL,
  houseRankFromKind,
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
          <button type="button" data-act="undo" title="Отменить">↩</button>
          <button type="button" data-act="end" class="primary">Конец хода</button>
          <button type="button" data-act="menu">Меню</button>
        </div>
      </header>
      <div class="main">
        <canvas id="gameCanvas"></canvas>
        <aside class="sidebar" id="sidebar"></aside>
      </div>
      <div class="toast" id="toast" hidden></div>
      <div class="modal" id="winModal" hidden>
        <div class="modal-card">
          <h2 id="winTitle">Победа</h2>
          <button type="button" data-act="menu" class="primary">В меню</button>
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
        html += btn('build:buildFarm', `Ферма (${fc})`, prov.money >= fc);
        html += btn('build:buildTower', `Башня (${TOWER_COST})`, prov.money >= TOWER_COST);
        html += btn(
          'build:buildStrongTower',
          `Кр. башня (${STRONG_TOWER_COST})`,
          prov.money >= STRONG_TOWER_COST,
        );
        html += `</div><h3>Домики призыва</h3><div class="btn-grid">`;
        for (const r of [1, 2, 3, 4] as const) {
          html += btn(
            `build:buildHouse${r}`,
            `Домик ${'I'.repeat(r)} (${HOUSE_COST[r]})`,
            prov.money >= HOUSE_COST[r],
          );
        }
        html += `</div>`;
        html += `<p class="hint">Юниты вызываются только из домиков: ранг N → домик N, появление через N ходов рядом с домиком.</p>`;
      }
    } else {
      html += `<p class="hint">Выберите свою провинцию на карте.</p>`;
    }

    if (sel && game.ui.mode === 'house' && sel.building) {
      const rank = houseRankFromKind(sel.building);
      if (rank) {
        html += `<h3>Домик ${rank}</h3>`;
        if (sel.training) {
          html += `<p>Обучение: ${UNIT_LABEL[sel.training.rank]}, осталось <b>${sel.training.turnsLeft}</b> ход(а).</p>`;
        } else if (human) {
          const cost = UNIT_COST[rank];
          const can = (prov?.money ?? 0) >= cost;
          html += `<p>Вызов: <b>${UNIT_LABEL[rank]}</b> за ${cost}🪙.<br/>Появятся через ${rank} ход(а) возле домика.</p>`;
          html += `<button type="button" class="primary wide" data-act="summon" ${can ? '' : 'disabled'}>Вызвать: ${UNIT_LABEL[rank]}</button>`;
        }
      }
    }

    if (sel?.unit) {
      const label = UNIT_LABEL[sel.unit.rank];
      html += `<h3>${label}</h3><p>Ранг ${sel.unit.rank}${sel.unit.moved ? ' (уже ходили)' : ''}. Защита соседних клеток = ранг.</p>`;
    }

    html += `
      <h3>Юниты</h3>
      <ul class="rules">
        <li>1 — 5 ополченцев с ружьями</li>
        <li>2 — 3 солдата</li>
        <li>3 — 3 спецназовца</li>
        <li>4 — танк</li>
      </ul>
      <h3>Правила кратко</h3>
      <ul class="rules">
        <li>Доход с гексов и ферм; юниты едят монеты.</li>
        <li>Захват: ранг юнита &gt; защиты клетки.</li>
        <li>Объединение юнитов усиливает ранг (до 4).</li>
        <li><b>Домики I–IV</b> — единственный способ вызвать юнитов.</li>
      </ul>
    `;

    panel.innerHTML = html;
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

interface HudHandlers {
  endTurn?: () => void;
  undo?: () => void;
  menu?: () => void;
  summon?: () => void;
  build?: (mode: SelectionMode) => void;
}
