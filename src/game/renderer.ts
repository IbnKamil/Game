import type { Game } from './Game';
import { hexCorners, hexToPixel, pixelToHex } from './hex';
import { drawBuildingFigurine, drawUnitFigurine } from './sprites';
import { cellKey, type UnitRank } from './types';

export const HEX_SIZE = 48; // was 32; figurines stay at previous world pixel size
const MIN_SCALE = 0.35;
const MAX_SCALE = 3.2;
/** Prefer ~1.5× larger hexes on screen vs full-fit (pan/zoom to explore). */
const FIT_ZOOM_BOOST = 1.5;

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  offsetX = 0;
  offsetY = 0;
  scale = 1;
  private fitScale = 1;
  private mapCenterX = 0;
  private mapCenterY = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D context unavailable');
    this.ctx = ctx;
  }

  resize(): void {
    const parent = this.canvas.parentElement;
    const w = parent?.clientWidth ?? window.innerWidth;
    const h = parent?.clientHeight ?? window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
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
    const mapW = maxX - minX + HEX_SIZE * 2.4;
    const mapH = maxY - minY + HEX_SIZE * 2.4;
    this.mapCenterX = (minX + maxX) / 2;
    this.mapCenterY = (minY + maxY) / 2;
    this.fitScale = Math.min(w / mapW, h / mapH) * 0.94;
    // Boost zoom so hexes read ~1.5× larger; figurines keep prior world size
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.fitScale * FIT_ZOOM_BOOST));
    this.offsetX = w / 2 - this.mapCenterX * this.scale;
    this.offsetY = h / 2 - this.mapCenterY * this.scale;
  }

  /** Zoom toward a screen point (canvas CSS pixels). */
  zoomAt(sx: number, sy: number, factor: number): void {
    const worldX = (sx - this.offsetX) / this.scale;
    const worldY = (sy - this.offsetY) / this.scale;
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * factor));
    this.scale = next;
    this.offsetX = sx - worldX * this.scale;
    this.offsetY = sy - worldY * this.scale;
  }

  /** Pan map by screen-pixel delta. */
  panBy(dx: number, dy: number): void {
    this.offsetX += dx;
    this.offsetY += dy;
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
    grad.addColorStop(0, '#163a45');
    grad.addColorStop(0.5, '#1f4f46');
    grad.addColorStop(1, '#1a3f58');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    const highlights = this.computeHighlights(game);
    const cells = Object.values(game.cells).sort((a, b) => a.r - b.r || a.q - b.q);

    for (const cell of cells) {
      const { x, y } = hexToPixel(cell.q, cell.r, HEX_SIZE);
      const key = cellKey(cell.q, cell.r);
      const owner = game.players.find((p) => p.id === cell.owner);
      const base = owner ? owner.color : '#6d8072';
      const corners = hexCorners(x, y, HEX_SIZE - 0.8);

      // Soft ground shadow under hex for depth
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.beginPath();
      ctx.ellipse(x, y + HEX_SIZE * 0.55, HEX_SIZE * 0.72, HEX_SIZE * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();

      // 3D-ish hex: fill + top highlight edge
      if (cell.owner === 0) {
        const g = ctx.createLinearGradient(x, y - HEX_SIZE, x, y + HEX_SIZE);
        g.addColorStop(0, '#7a8f80');
        g.addColorStop(1, '#55695c');
        ctx.fillStyle = g;
        ctx.globalAlpha = 0.92;
      } else {
        const g = ctx.createLinearGradient(x - HEX_SIZE, y - HEX_SIZE, x + HEX_SIZE, y + HEX_SIZE);
        g.addColorStop(0, shadeHex(base, 28));
        g.addColorStop(0.55, base);
        g.addColorStop(1, shadeHex(base, -22));
        ctx.fillStyle = g;
        ctx.globalAlpha = 0.94;
      }
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.35;
      ctx.stroke();

      // Bright top edge for clarity
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(corners[5].x, corners[5].y);
      ctx.lineTo(corners[0].x, corners[0].y);
      ctx.lineTo(corners[1].x, corners[1].y);
      ctx.stroke();

      if (highlights.has(key)) {
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
        ctx.closePath();
        ctx.fillStyle = highlights.get(key)!;
        ctx.globalAlpha = 0.32;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      if (game.ui.selectedKey === key) {
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
        ctx.closePath();
        ctx.strokeStyle = '#fff6c2';
        ctx.lineWidth = 2.8;
        ctx.stroke();
      }

      if (cell.tree) {
        drawTree3d(ctx, x, y, cell.palm);
      }

      if (cell.building) {
        drawBuildingFigurine(ctx, x, y - 2, cell.building, cell.training?.turnsLeft ?? null);
      }

      if (cell.unit) {
        const team = game.players.find((p) => p.id === cell.unit!.owner)?.color ?? '#212529';
        const uy = cell.building ? y + 10 : y + 3;
        drawUnitFigurine(ctx, x, uy, cell.unit.rank as UnitRank, cell.unit.moved, team);
      }
    }

    ctx.restore();
  }

  private computeHighlights(game: Game): Map<string, string> {
    const map = new Map<string, string>();
    if (game.ui.mode === 'unit' && game.ui.selectedKey) {
      for (const k of game.moveTargets(game.ui.selectedKey)) map.set(k, '#ffd43b');
    }
    if (game.ui.mode.startsWith('build')) {
      for (const k of game.buildTargets(game.ui.mode)) map.set(k, '#69db7c');
    }
    if (game.ui.hoverKey) map.set(game.ui.hoverKey, '#a5d8ff');
    return map;
  }
}

function shadeHex(hex: string, amt: number): string {
  const raw = hex.replace('#', '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return hex;
  const r = Math.min(255, Math.max(0, ((num >> 16) & 255) + amt));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 255) + amt));
  const b = Math.min(255, Math.max(0, (num & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

function drawTree3d(ctx: CanvasRenderingContext2D, x: number, y: number, palm: boolean): void {
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(x, y + 6, 6, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#6b4226';
  ctx.fillRect(x - 1.4, y - 2, 2.8, 8);
  if (palm) {
    ctx.fillStyle = '#2b8a3e';
    for (const a of [-0.8, -0.2, 0.4, 1]) {
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(a) * 5, y - 6 + Math.sin(a), 5, 2, a, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    const g = ctx.createRadialGradient(x - 2, y - 8, 1, x, y - 4, 9);
    g.addColorStop(0, '#51cf66');
    g.addColorStop(1, '#1b4332');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y - 5, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x - 4, y - 2, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 4, y - 2, 5.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
