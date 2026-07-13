import type { Game } from './Game';
import { hexToPixel, pixelToHex } from './hex';
import { drawUnitLod } from './sprites';
import { cellKey, type BuildingKind, type HexCell, type UnitRank } from './types';

export const HEX_SIZE = 48;
const MIN_SCALE = 0.35;
const MAX_SCALE = 3.2;
const FIT_ZOOM_BOOST = 1.5;
const HEX_R = HEX_SIZE - 0.8;
const CACHE_PAD = HEX_SIZE * 2;

const HEX_OX: number[] = [];
const HEX_OY: number[] = [];
for (let i = 0; i < 6; i++) {
  const a = (Math.PI / 180) * (60 * i);
  HEX_OX.push(HEX_R * Math.cos(a));
  HEX_OY.push(HEX_R * Math.sin(a));
}

/**
 * Renders via a cached world-space map layer (terrain/buildings/trees).
 * Pan/zoom/hover only blit the cache + lightweight unit/highlight overlays.
 */
export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  offsetX = 0;
  offsetY = 0;
  scale = 1;
  private fitScale = 1;
  private mapCenterX = 0;
  private mapCenterY = 0;

  private sortedCells: HexCell[] = [];
  private cellCount = -1;
  private posX = new Float32Array(0);
  private posY = new Float32Array(0);
  private ownerColors = new Map<number, string>();

  private mapCache: HTMLCanvasElement | null = null;
  private mapCtx: CanvasRenderingContext2D | null = null;
  private cacheOriginX = 0;
  private cacheOriginY = 0;
  private cacheRevision = -1;
  private cacheOwnerSig = '';

  private moveHighlightSig = '';
  private moveHighlightKeys: string[] = [];

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
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    const tw = Math.floor(w * dpr);
    const th = Math.floor(h * dpr);
    if (this.canvas.width === tw && this.canvas.height === th) {
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return;
    }
    this.canvas.width = tw;
    this.canvas.height = th;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
  }

  centerOnMap(game: Game): void {
    this.refreshCellCache(game);
    if (this.sortedCells.length === 0) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < this.sortedCells.length; i++) {
      minX = Math.min(minX, this.posX[i]);
      maxX = Math.max(maxX, this.posX[i]);
      minY = Math.min(minY, this.posY[i]);
      maxY = Math.max(maxY, this.posY[i]);
    }
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.mapCenterX = (minX + maxX) / 2;
    this.mapCenterY = (minY + maxY) / 2;
    this.fitScale = Math.min(w / (maxX - minX + HEX_SIZE * 2.4), h / (maxY - minY + HEX_SIZE * 2.4)) * 0.94;
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
    return pixelToHex((sx - this.offsetX) / this.scale, (sy - this.offsetY) / this.scale, HEX_SIZE);
  }

  /** Force terrain cache rebuild (e.g. after loading sprites). */
  invalidateMapCache(): void {
    this.cacheRevision = -1;
  }

  private refreshCellCache(game: Game): void {
    const n = Object.keys(game.cells).length;
    if (n === this.cellCount && this.sortedCells.length === n) return;
    this.sortedCells = Object.values(game.cells).sort((a, b) => a.r - b.r || a.q - b.q);
    this.cellCount = n;
    this.posX = new Float32Array(n);
    this.posY = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = hexToPixel(this.sortedCells[i].q, this.sortedCells[i].r, HEX_SIZE);
      this.posX[i] = p.x;
      this.posY[i] = p.y;
    }
    this.cacheRevision = -1;
  }

  private refreshOwnerColors(game: Game): void {
    let sig = '';
    for (const p of game.players) sig += `${p.id}:${p.color};`;
    if (sig === this.cacheOwnerSig && this.ownerColors.size === game.players.length) return;
    this.cacheOwnerSig = sig;
    this.ownerColors.clear();
    for (const p of game.players) this.ownerColors.set(p.id, p.color);
    this.cacheRevision = -1;
  }

  private ensureMapCache(game: Game): void {
    this.refreshCellCache(game);
    this.refreshOwnerColors(game);
    if (this.cacheRevision === game.terrainRevision && this.mapCache && this.mapCtx) return;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < this.sortedCells.length; i++) {
      minX = Math.min(minX, this.posX[i]);
      maxX = Math.max(maxX, this.posX[i]);
      minY = Math.min(minY, this.posY[i]);
      maxY = Math.max(maxY, this.posY[i]);
    }
    if (!Number.isFinite(minX)) return;

    this.cacheOriginX = minX - CACHE_PAD;
    this.cacheOriginY = minY - CACHE_PAD;
    const width = Math.ceil(maxX - minX + CACHE_PAD * 2);
    const height = Math.ceil(maxY - minY + CACHE_PAD * 2);

    if (!this.mapCache || this.mapCache.width !== width || this.mapCache.height !== height) {
      this.mapCache = document.createElement('canvas');
      this.mapCache.width = width;
      this.mapCache.height = height;
      this.mapCtx = this.mapCache.getContext('2d', { alpha: false });
    }
    const mctx = this.mapCtx!;
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.fillStyle = '#1a4550';
    mctx.fillRect(0, 0, width, height);
    mctx.imageSmoothingEnabled = false;

    for (let i = 0; i < this.sortedCells.length; i++) {
      const cell = this.sortedCells[i];
      const x = this.posX[i] - this.cacheOriginX;
      const y = this.posY[i] - this.cacheOriginY;
      const base = cell.owner === 0 ? '#6d8072' : (this.ownerColors.get(cell.owner) ?? '#6d8072');

      pathHex(mctx, x, y);
      mctx.fillStyle = base;
      mctx.globalAlpha = cell.owner === 0 ? 0.9 : 0.95;
      mctx.fill();
      mctx.globalAlpha = 1;
      mctx.strokeStyle = 'rgba(0,0,0,0.28)';
      mctx.lineWidth = 1;
      mctx.stroke();

      if (cell.tree) {
        mctx.fillStyle = '#6b4226';
        mctx.fillRect(x - 1.2, y - 1, 2.4, 7);
        mctx.fillStyle = '#2b8a3e';
        mctx.beginPath();
        mctx.arc(x, y - 5, 6.5, 0, Math.PI * 2);
        mctx.fill();
      }

      if (cell.building) {
        drawBuildingSimple(mctx, x, y, cell.building, cell.training?.turnsLeft ?? null);
      }
    }

    this.cacheRevision = game.terrainRevision;
  }

  draw(game: Game): void {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;

    this.ensureMapCache(game);

    ctx.setTransform(
      Math.min(window.devicePixelRatio || 1, 1.25),
      0,
      0,
      Math.min(window.devicePixelRatio || 1, 1.25),
      0,
      0,
    );
    ctx.fillStyle = '#143542';
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);
    ctx.imageSmoothingEnabled = this.scale < 1.1;

    if (this.mapCache) {
      ctx.drawImage(this.mapCache, this.cacheOriginX, this.cacheOriginY);
    }

    // Dynamic overlays only
    const highlights = this.computeHighlights(game);
    const margin = HEX_SIZE * 1.8;
    const minX = (-this.offsetX) / this.scale - margin;
    const maxX = (w - this.offsetX) / this.scale + margin;
    const minY = (-this.offsetY) / this.scale - margin;
    const maxY = (h - this.offsetY) / this.scale + margin;

    for (let i = 0; i < this.sortedCells.length; i++) {
      const x = this.posX[i];
      const y = this.posY[i];
      if (x < minX || x > maxX || y < minY || y > maxY) continue;
      const cell = this.sortedCells[i];
      const key = cellKey(cell.q, cell.r);

      if (highlights.has(key)) {
        pathHex(ctx, x, y);
        ctx.fillStyle = highlights.get(key)!;
        ctx.globalAlpha = 0.3;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      if (game.ui.selectedKey === key) {
        pathHex(ctx, x, y);
        ctx.strokeStyle = '#fff6c2';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }

      if (cell.unit) {
        const team = this.ownerColors.get(cell.unit.owner) ?? '#212529';
        const uy = cell.building ? y + 10 : y + 3;
        drawUnitLod(ctx, x, uy, cell.unit.rank as UnitRank, cell.unit.moved, team);
      }
    }

    ctx.restore();
  }

  private computeHighlights(game: Game): Map<string, string> {
    const map = new Map<string, string>();
    const sig = `${game.ui.mode}:${game.ui.selectedKey ?? ''}:${game.terrainRevision}`;
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

function drawBuildingSimple(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  kind: BuildingKind,
  trainLeft: number | null,
): void {
  if (kind === 'farm') {
    ctx.fillStyle = '#f4d35e';
    ctx.fillRect(x - 7, y - 2, 14, 8);
    ctx.fillStyle = '#c9a227';
    ctx.fillRect(x - 5, y - 6, 10, 4);
  } else if (kind === 'tower' || kind === 'strongTower') {
    ctx.fillStyle = kind === 'strongTower' ? '#adb5bd' : '#868e96';
    ctx.fillRect(x - 5, y - 14, 10, 18);
    ctx.fillStyle = '#495057';
    ctx.fillRect(x - 7, y - 18, 14, 5);
  } else if (kind === 'castle') {
    ctx.fillStyle = '#e9ecef';
    ctx.fillRect(x - 10, y - 12, 20, 16);
    ctx.fillStyle = '#ced4da';
    ctx.fillRect(x - 12, y - 18, 8, 10);
    ctx.fillRect(x + 4, y - 18, 8, 10);
  } else {
    // houses / barracks
    ctx.fillStyle = '#ffe8cc';
    ctx.fillRect(x - 8, y - 6, 16, 12);
    ctx.fillStyle = '#e8590c';
    ctx.beginPath();
    ctx.moveTo(x - 10, y - 6);
    ctx.lineTo(x, y - 16);
    ctx.lineTo(x + 10, y - 6);
    ctx.closePath();
    ctx.fill();
  }
  if (trainLeft != null) {
    ctx.fillStyle = '#212529';
    ctx.beginPath();
    ctx.arc(x + 10, y - 14, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(trainLeft), x + 10, y - 13.5);
  }
}
