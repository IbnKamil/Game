import type { Game } from './Game';
import { hexCorners, hexToPixel, pixelToHex } from './hex';
import { drawBuildingFigurine, drawUnitFigurine } from './sprites';
import { cellKey, type UnitRank } from './types';

const HEX_SIZE = 28;

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  offsetX = 0;
  offsetY = 0;
  scale = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  resize(): void {
    const parent = this.canvas.parentElement;
    const w = parent?.clientWidth ?? window.innerWidth;
    const h = parent?.clientHeight ?? window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  centerOnMap(game: Game): void {
    const keys = Object.keys(game.cells);
    if (keys.length === 0) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const cell of Object.values(game.cells)) {
      const { x, y } = hexToPixel(cell.q, cell.r, HEX_SIZE);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const mapW = maxX - minX + HEX_SIZE * 2;
    const mapH = maxY - minY + HEX_SIZE * 2;
    this.scale = Math.min(1.15, Math.min(w / mapW, h / mapH) * 0.92);
    this.offsetX = w / 2 - ((minX + maxX) / 2) * this.scale;
    this.offsetY = h / 2 - ((minY + maxY) / 2) * this.scale;
  }

  screenToHex(sx: number, sy: number): { q: number; r: number } {
    const x = (sx - this.offsetX) / this.scale;
    const y = (sy - this.offsetY) / this.scale;
    return pixelToHex(x, y, HEX_SIZE);
  }

  draw(game: Game): void {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;

    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#1a3a4a');
    grad.addColorStop(0.45, '#245a48');
    grad.addColorStop(1, '#1e3d5c');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const radial = ctx.createRadialGradient(w * 0.5, h * 0.4, 40, w * 0.5, h * 0.5, w * 0.7);
    radial.addColorStop(0, 'rgba(255,255,255,0.06)');
    radial.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    const highlights = this.computeHighlights(game);

    for (const cell of Object.values(game.cells)) {
      const { x, y } = hexToPixel(cell.q, cell.r, HEX_SIZE);
      const key = cellKey(cell.q, cell.r);
      const owner = game.players.find((p) => p.id === cell.owner);
      const base = owner ? owner.color : '#6b7c6e';
      const corners = hexCorners(x, y, HEX_SIZE - 1);

      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();

      ctx.fillStyle = cell.owner === 0 ? '#5f7366' : base;
      ctx.globalAlpha = cell.owner === 0 ? 0.75 : 0.88;
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      if (highlights.has(key)) {
        ctx.fillStyle = highlights.get(key)!;
        ctx.globalAlpha = 0.35;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      if (game.ui.selectedKey === key) {
        ctx.strokeStyle = '#fff6c2';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }

      if (cell.tree) {
        ctx.fillStyle = cell.palm ? '#2b8a3e' : '#1b4332';
        ctx.beginPath();
        ctx.arc(x, y - 2, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#6b4226';
        ctx.fillRect(x - 1.5, y + 2, 3, 6);
      }

      if (cell.building) {
        drawBuildingFigurine(ctx, x, y - 2, cell.building, cell.training?.turnsLeft ?? null);
      }

      if (cell.unit) {
        const team = game.players.find((p) => p.id === cell.unit!.owner)?.color ?? '#212529';
        const uy = cell.building ? y + 8 : y + 2;
        drawUnitFigurine(ctx, x, uy, cell.unit.rank as UnitRank, cell.unit.moved, team);
      }
    }

    ctx.restore();
  }

  private computeHighlights(game: Game): Map<string, string> {
    const map = new Map<string, string>();
    if (game.ui.mode === 'unit' && game.ui.selectedKey) {
      for (const k of game.moveTargets(game.ui.selectedKey)) {
        map.set(k, '#ffd43b');
      }
    }
    if (game.ui.mode.startsWith('build')) {
      for (const k of game.buildTargets(game.ui.mode)) {
        map.set(k, '#69db7c');
      }
    }
    if (game.ui.hoverKey) {
      map.set(game.ui.hoverKey, '#a5d8ff');
    }
    return map;
  }
}
