import type { Game } from './Game';
import { hexToPixel, pixelToHex } from './hex';
import { drawBuildingFigurine, drawUnitFigurine, drawUnitLod } from './sprites';
import { cellKey, type HexCell, type UnitRank } from './types';

export const HEX_SIZE = 48;
const MIN_SCALE = 0.35;
const MAX_SCALE = 3.2;
const FIT_ZOOM_BOOST = 1.5;
const HEX_R = HEX_SIZE - 0.8;

/** Precomputed flat-top hex corner offsets. */
const HEX_OX: number[] = [];
const HEX_OY: number[] = [];
for (let i = 0; i < 6; i++) {
  const a = (Math.PI / 180) * (60 * i);
  HEX_OX.push(HEX_R * Math.cos(a));
  HEX_OY.push(HEX_R * Math.sin(a));
}

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  offsetX = 0;
  offsetY = 0;
  scale = 1;
  /** Cheap draw path while panning / zooming. */
  fastMode = false;
  private fitScale = 1;
  private mapCenterX = 0;
  private mapCenterY = 0;
  private sortedCells: HexCell[] = [];
  private cellCount = -1;
  private posX = new Float32Array(0);
  private posY = new Float32Array(0);
  private ownerColors = new Map<number, string>();
  private moveHighlightSig = '';
  private moveHighlightKeys: string[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) throw new Error('2D context unavailable');
    this.ctx = ctx;
  }

  resize(): void {
    const parent = this.canvas.parentElement;
    const w = parent?.clientWidth ?? window.innerWidth;
    const h = parent?.clientHeight ?? window.innerHeight;
    // Cap DPR — high-DPI full redraws are a major freeze source
    const dprCap = this.fastMode ? 1 : 1.25;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = !this.fastMode;
    this.ctx.imageSmoothingQuality = 'low';
  }

  centerOnMap(game: Game): void {
    this.refreshCellCache(game);
    if (this.sortedCells.length === 0) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < this.sortedCells.length; i++) {
      const x = this.posX[i];
      const y = this.posY[i];
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
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.fitScale * FIT_ZOOM_BOOST));
    this.offsetX = w / 2 - this.mapCenterX * this.scale;
    this.offsetY = h / 2 - this.mapCenterY * this.scale;
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const worldX = (sx - this.offsetX) / this.scale;
    const worldY = (sy - this.offsetY) / this.scale;
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * factor));
    this.offsetX = sx - worldX * this.scale;
    this.offsetY = sy - worldY * this.scale;
  }

  panBy(dx: number, dy: number): void {
    this.offsetX += dx;
    this.offsetY += dy;
  }

  screenToHex(sx: number, sy: number): { q: number; r: number } {
    const x = (sx - this.offsetX) / this.scale;
    const y = (sy - this.offsetY) / this.scale;
    return pixelToHex(x, y, HEX_SIZE);
  }

  private refreshCellCache(game: Game): void {
    const keys = Object.keys(game.cells);
    if (keys.length === this.cellCount && this.sortedCells.length === keys.length) return;
    this.sortedCells = Object.values(game.cells).sort((a, b) => a.r - b.r || a.q - b.q);
    this.cellCount = keys.length;
    this.posX = new Float32Array(this.sortedCells.length);
    this.posY = new Float32Array(this.sortedCells.length);
    for (let i = 0; i < this.sortedCells.length; i++) {
      const c = this.sortedCells[i];
      const p = hexToPixel(c.q, c.r, HEX_SIZE);
      this.posX[i] = p.x;
      this.posY[i] = p.y;
    }
  }

  private refreshOwnerColors(game: Game): void {
    if (this.ownerColors.size === game.players.length) {
      let ok = true;
      for (const p of game.players) {
        if (this.ownerColors.get(p.id) !== p.color) {
          ok = false;
          break;
        }
      }
      if (ok) return;
    }
    this.ownerColors.clear();
    for (const p of game.players) this.ownerColors.set(p.id, p.color);
  }

  draw(game: Game): void {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const fast = this.fastMode;
    const useLod = fast || this.scale < 1.25;

    ctx.fillStyle = '#1a4550';
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    this.refreshCellCache(game);
    this.refreshOwnerColors(game);

    const highlights = fast ? null : this.computeHighlights(game);
    const hoverKey = game.ui.hoverKey;
    const selectedKey = game.ui.selectedKey;

    const margin = HEX_SIZE * 2;
    const minX = (-this.offsetX) / this.scale - margin;
    const maxX = (w - this.offsetX) / this.scale + margin;
    const minY = (-this.offsetY) / this.scale - margin;
    const maxY = (h - this.offsetY) / this.scale + margin;

    const cells = this.sortedCells;
    for (let i = 0; i < cells.length; i++) {
      const x = this.posX[i];
      const y = this.posY[i];
      if (x < minX || x > maxX || y < minY || y > maxY) continue;

      const cell = cells[i];
      const key = cellKey(cell.q, cell.r);
      const base = cell.owner === 0 ? '#6d8072' : (this.ownerColors.get(cell.owner) ?? '#6d8072');

      pathHex(ctx, x, y);
      ctx.fillStyle = base;
      ctx.globalAlpha = cell.owner === 0 ? 0.88 : 0.94;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = fast ? 0.9 : 1.15;
      ctx.stroke();

      if (!fast && highlights?.has(key)) {
        pathHex(ctx, x, y);
        ctx.fillStyle = highlights.get(key)!;
        ctx.globalAlpha = 0.3;
        ctx.fill();
        ctx.globalAlpha = 1;
      } else if (fast && (key === hoverKey || key === selectedKey)) {
        pathHex(ctx, x, y);
        ctx.fillStyle = key === selectedKey ? '#fff6c2' : '#a5d8ff';
        ctx.globalAlpha = 0.28;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      if (!fast && selectedKey === key) {
        pathHex(ctx, x, y);
        ctx.strokeStyle = '#fff6c2';
        ctx.lineWidth = 2.6;
        ctx.stroke();
      }

      if (cell.tree) {
        if (fast) {
          ctx.fillStyle = '#2f9e44';
          ctx.fillRect(x - 3, y - 6, 6, 10);
        } else {
          drawTreeSimple(ctx, x, y);
        }
      }

      if (cell.building) {
        if (fast) {
          ctx.fillStyle = '#e9ecef';
          ctx.fillRect(x - 6, y - 10, 12, 12);
          ctx.fillStyle = '#495057';
          ctx.fillRect(x - 3, y - 14, 6, 5);
        } else {
          drawBuildingFigurine(ctx, x, y - 2, cell.building, cell.training?.turnsLeft ?? null);
        }
      }

      if (cell.unit) {
        const team = this.ownerColors.get(cell.unit.owner) ?? '#212529';
        const uy = cell.building ? y + 10 : y + 3;
        const rank = cell.unit.rank as UnitRank;
        if (useLod) {
          drawUnitLod(ctx, x, uy, rank, cell.unit.moved, team);
        } else {
          drawUnitFigurine(ctx, x, uy, rank, cell.unit.moved, team);
        }
      }
    }

    ctx.restore();
  }

  private computeHighlights(game: Game): Map<string, string> {
    const map = new Map<string, string>();
    const sig = `${game.ui.mode}:${game.ui.selectedKey ?? ''}`;
    if (sig !== this.moveHighlightSig) {
      this.moveHighlightSig = sig;
      this.moveHighlightKeys = [];
      if (game.ui.mode === 'unit' && game.ui.selectedKey) {
        this.moveHighlightKeys = [...game.moveTargets(game.ui.selectedKey)];
      } else if (game.ui.mode.startsWith('build')) {
        this.moveHighlightKeys = [...game.buildTargets(game.ui.mode)];
      }
    }
    const color = game.ui.mode.startsWith('build') ? '#69db7c' : '#ffd43b';
    for (const k of this.moveHighlightKeys) map.set(k, color);
    if (game.ui.hoverKey) map.set(game.ui.hoverKey, '#a5d8ff');
    return map;
  }
}

function pathHex(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.beginPath();
  ctx.moveTo(x + HEX_OX[0], y + HEX_OY[0]);
  for (let i = 1; i < 6; i++) ctx.lineTo(x + HEX_OX[i], y + HEX_OY[i]);
  ctx.closePath();
}

function drawTreeSimple(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = '#6b4226';
  ctx.fillRect(x - 1.2, y - 1, 2.4, 7);
  ctx.fillStyle = '#2b8a3e';
  ctx.beginPath();
  ctx.arc(x, y - 5, 7, 0, Math.PI * 2);
  ctx.fill();
}
