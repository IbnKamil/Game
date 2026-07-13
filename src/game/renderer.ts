import type { Game } from './Game';
import { HEX_DIRS, hexToPixel, pixelToHex } from './hex';
import { drawBuildingFigurine, drawUnitFigurine } from './sprites';
import { elevationBand, shadeRgbHex, topoWithOwner } from './topo';
import { cellKey, type HexCell, type UnitRank } from './types';

export const HEX_SIZE = 48;
const MIN_SCALE = 0.35;
const MAX_SCALE = 3.2;
const FIT_ZOOM_BOOST = 1.5;
const HEX_R = HEX_SIZE - 0.8;
const CACHE_PAD = HEX_SIZE * 2;
const TOPO_BANDS = 8;

const HEX_OX: number[] = [];
const HEX_OY: number[] = [];
for (let i = 0; i < 6; i++) {
  const a = (Math.PI / 180) * (60 * i);
  HEX_OX.push(HEX_R * Math.cos(a));
  HEX_OY.push(HEX_R * Math.sin(a));
}

/**
 * Dual-canvas map with CSS camera.
 * Pan/zoom updates a CSS transform only (no canvas redraw).
 * Terrain canvas rebuilds only when terrainRevision changes.
 * Overlay canvas redraws for units / selection / hover.
 */
export class Renderer {
  viewport: HTMLElement;
  world: HTMLElement;
  terrain: HTMLCanvasElement;
  overlay: HTMLCanvasElement;
  private tctx: CanvasRenderingContext2D;
  private octx: CanvasRenderingContext2D;

  offsetX = 0;
  offsetY = 0;
  scale = 1;
  private fitScale = 1;
  private mapCenterX = 0;
  private mapCenterY = 0;

  private sortedCells: HexCell[] = [];
  private cellCount = -1;
  /** Detect undo/restore replacing the cells object (same count, new refs). */
  private cellsRef: Record<string, HexCell> | null = null;
  private posX = new Float32Array(0);
  private posY = new Float32Array(0);
  private ownerColors = new Map<number, string>();

  private originX = 0;
  private originY = 0;
  private cacheRevision = -1;
  private cacheOwnerSig = '';
  private moveHighlightSig = '';
  private moveHighlightKeys: string[] = [];
  private lastOverlayKey = '';

  /** @deprecated kept so old call sites compile; use terrain/overlay */
  get canvas(): HTMLCanvasElement {
    return this.overlay;
  }

  constructor(viewport: HTMLElement) {
    this.viewport = viewport;
    const world = viewport.querySelector('#mapWorld') as HTMLElement | null;
    const terrain = viewport.querySelector('#terrainCanvas') as HTMLCanvasElement | null;
    const overlay = viewport.querySelector('#overlayCanvas') as HTMLCanvasElement | null;
    if (!world || !terrain || !overlay) throw new Error('Map layers missing');
    this.world = world;
    this.terrain = terrain;
    this.overlay = overlay;
    const tctx = terrain.getContext('2d', { alpha: false });
    const octx = overlay.getContext('2d', { alpha: true });
    if (!tctx || !octx) throw new Error('2D context unavailable');
    this.tctx = tctx;
    this.octx = octx;
    this.applyCamera();
  }

  resize(): void {
    // Viewport is CSS-sized; canvases are world-sized and set in ensureTerrain.
  }

  centerOnMap(game: Game): void {
    this.refreshCellCache(game);
    this.ensureTerrain(game);
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
    const w = this.viewport.clientWidth;
    const h = this.viewport.clientHeight;
    this.mapCenterX = (minX + maxX) / 2;
    this.mapCenterY = (minY + maxY) / 2;
    this.fitScale =
      Math.min(w / (maxX - minX + HEX_SIZE * 2.4), h / (maxY - minY + HEX_SIZE * 2.4)) * 0.94;
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.fitScale * FIT_ZOOM_BOOST));
    this.offsetX = w / 2 - this.mapCenterX * this.scale;
    this.offsetY = h / 2 - this.mapCenterY * this.scale;
    this.applyCamera();
  }

  /** CSS-only camera update — no canvas work. */
  applyCamera(): void {
    this.world.style.transform = `matrix(${this.scale}, 0, 0, ${this.scale}, ${this.offsetX}, ${this.offsetY})`;
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const worldX = (sx - this.offsetX) / this.scale;
    const worldY = (sy - this.offsetY) / this.scale;
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * factor));
    this.offsetX = sx - worldX * this.scale;
    this.offsetY = sy - worldY * this.scale;
    this.applyCamera();
  }

  panBy(dx: number, dy: number): void {
    this.offsetX += dx;
    this.offsetY += dy;
    this.applyCamera();
  }

  screenToHex(sx: number, sy: number): { q: number; r: number } {
    return pixelToHex((sx - this.offsetX) / this.scale, (sy - this.offsetY) / this.scale, HEX_SIZE);
  }

  invalidateMapCache(): void {
    this.cacheRevision = -1;
    this.lastOverlayKey = '';
  }

  private refreshCellCache(game: Game): void {
    const n = Object.keys(game.cells).length;
    // Must refresh when undo/restore swaps in a new cells record — count stays the same
    // but sortedCells would otherwise keep drawing the pre-undo HexCell objects.
    if (
      this.cellsRef === game.cells &&
      n === this.cellCount &&
      this.sortedCells.length === n
    ) {
      return;
    }
    this.cellsRef = game.cells;
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

  private ensureTerrain(game: Game): void {
    this.refreshCellCache(game);
    this.refreshOwnerColors(game);
    if (this.cacheRevision === game.terrainRevision && this.terrain.width > 0) return;

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

    this.originX = minX - CACHE_PAD;
    this.originY = minY - CACHE_PAD;
    const width = Math.max(1, Math.ceil(maxX - minX + CACHE_PAD * 2));
    const height = Math.max(1, Math.ceil(maxY - minY + CACHE_PAD * 2));

    if (this.terrain.width !== width || this.terrain.height !== height) {
      this.terrain.width = width;
      this.terrain.height = height;
      this.overlay.width = width;
      this.overlay.height = height;
    }
    this.terrain.style.left = `${this.originX}px`;
    this.terrain.style.top = `${this.originY}px`;
    this.overlay.style.left = `${this.originX}px`;
    this.overlay.style.top = `${this.originY}px`;

    const ctx = this.tctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1a3a42';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';

    // Pass 1: topographic fill + owner tint
    for (let i = 0; i < this.sortedCells.length; i++) {
      const cell = this.sortedCells[i];
      const x = this.posX[i] - this.originX;
      const y = this.posY[i] - this.originY;
      const elev = cell.elevation ?? 0.45;
      const ownerCol =
        cell.owner === 0 ? null : (this.ownerColors.get(cell.owner) ?? null);
      const fill = topoWithOwner(elev, ownerCol, cell.owner !== 0);

      pathHex(ctx, x, y);
      // Soft relief shading inside the hex
      const grad = ctx.createRadialGradient(x - 6, y - 8, 2, x, y, HEX_R * 1.05);
      grad.addColorStop(0, shadeRgbHex(fill, 18));
      grad.addColorStop(0.55, fill);
      grad.addColorStop(1, shadeRgbHex(fill, -22));
      ctx.fillStyle = grad;
      ctx.globalAlpha = 1;
      ctx.fill();

      // Fine topo hatch (subtle)
      ctx.save();
      pathHex(ctx, x, y);
      ctx.clip();
      ctx.strokeStyle = 'rgba(60, 48, 32, 0.07)';
      ctx.lineWidth = 1;
      const band = elevationBand(elev, TOPO_BANDS);
      const step = 5 + (band % 3);
      for (let hx = x - HEX_R; hx < x + HEX_R; hx += step) {
        ctx.beginPath();
        ctx.moveTo(hx, y - HEX_R);
        ctx.lineTo(hx + HEX_R * 0.35, y + HEX_R);
        ctx.stroke();
      }
      ctx.restore();

      ctx.strokeStyle = 'rgba(20, 28, 24, 0.22)';
      ctx.lineWidth = 1;
      pathHex(ctx, x, y);
      ctx.stroke();
    }

    // Pass 2: contour lines between elevation bands
    ctx.lineCap = 'round';
    for (let i = 0; i < this.sortedCells.length; i++) {
      const cell = this.sortedCells[i];
      const x = this.posX[i] - this.originX;
      const y = this.posY[i] - this.originY;
      const band = elevationBand(cell.elevation ?? 0.45, TOPO_BANDS);
      for (let d = 0; d < 6; d++) {
        const n = HEX_DIRS[d]!;
        const nk = cellKey(cell.q + n.q, cell.r + n.r);
        const nc = game.cells[nk];
        if (!nc) {
          // Coastline / map edge — darker contour
          const i0 = d;
          const i1 = (d + 1) % 6;
          ctx.strokeStyle = 'rgba(15, 35, 40, 0.55)';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(x + HEX_OX[i0]!, y + HEX_OY[i0]!);
          ctx.lineTo(x + HEX_OX[i1]!, y + HEX_OY[i1]!);
          ctx.stroke();
          continue;
        }
        // Draw each shared edge once (from the lower-band hex)
        const nBand = elevationBand(nc.elevation ?? 0.45, TOPO_BANDS);
        if (nBand <= band) continue;
        const i0 = d;
        const i1 = (d + 1) % 6;
        const major = nBand - band >= 2;
        ctx.strokeStyle = major ? 'rgba(72, 52, 28, 0.55)' : 'rgba(72, 52, 28, 0.32)';
        ctx.lineWidth = major ? 1.7 : 1.1;
        ctx.beginPath();
        ctx.moveTo(x + HEX_OX[i0]!, y + HEX_OY[i0]!);
        ctx.lineTo(x + HEX_OX[i1]!, y + HEX_OY[i1]!);
        ctx.stroke();
      }
    }

    // Pass 2b: political borders (owner changes) on top of contours
    for (let i = 0; i < this.sortedCells.length; i++) {
      const cell = this.sortedCells[i];
      const x = this.posX[i] - this.originX;
      const y = this.posY[i] - this.originY;
      for (let d = 0; d < 6; d++) {
        const n = HEX_DIRS[d]!;
        const nk = cellKey(cell.q + n.q, cell.r + n.r);
        const nc = game.cells[nk];
        if (!nc) continue;
        if (nc.owner === cell.owner) continue;
        // Draw once from the lower id / lower key to avoid doubles — use owner id compare
        if (cell.owner > nc.owner) continue;
        const i0 = d;
        const i1 = (d + 1) % 6;
        ctx.strokeStyle =
          cell.owner === 0 || nc.owner === 0
            ? 'rgba(255, 255, 255, 0.28)'
            : 'rgba(255, 255, 255, 0.45)';
        ctx.lineWidth = cell.owner === 0 || nc.owner === 0 ? 1.4 : 2.1;
        ctx.beginPath();
        ctx.moveTo(x + HEX_OX[i0]!, y + HEX_OY[i0]!);
        ctx.lineTo(x + HEX_OX[i1]!, y + HEX_OY[i1]!);
        ctx.stroke();
      }
    }

    // Pass 3: trees + buildings (above topo)
    for (let i = 0; i < this.sortedCells.length; i++) {
      const cell = this.sortedCells[i];
      const x = this.posX[i] - this.originX;
      const y = this.posY[i] - this.originY;

      if (cell.tree) {
        ctx.fillStyle = '#6b4226';
        ctx.fillRect(x - 1.2, y - 1, 2.4, 7);
        ctx.fillStyle = '#2b8a3e';
        ctx.beginPath();
        ctx.arc(x, y - 5, 6.5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (cell.building) {
        drawBuildingFigurine(ctx, x, y - 2, cell.building, cell.training?.turnsLeft ?? null);
      }
    }

    this.cacheRevision = game.terrainRevision;
    this.lastOverlayKey = '';
  }

  /** Full content sync (terrain if needed + overlay). Does not touch camera. */
  draw(game: Game): void {
    this.ensureTerrain(game);
    this.drawOverlay(game, true);
  }

  /** Overlay only (units/highlights). Safe to call often. */
  drawOverlay(game: Game, force = false): void {
    this.refreshOwnerColors(game);
    const key = overlayStateKey(game);
    if (!force && key === this.lastOverlayKey) return;
    this.lastOverlayKey = key;

    const ctx = this.octx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';

    const highlights = this.computeHighlights(game);
    for (let i = 0; i < this.sortedCells.length; i++) {
      const cell = this.sortedCells[i];
      const x = this.posX[i] - this.originX;
      const y = this.posY[i] - this.originY;
      const ckey = cellKey(cell.q, cell.r);

      if (highlights.has(ckey)) {
        pathHex(ctx, x, y);
        ctx.fillStyle = highlights.get(ckey)!;
        ctx.globalAlpha = 0.32;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (game.ui.selectedKey === ckey) {
        pathHex(ctx, x, y);
        ctx.strokeStyle = '#fff6c2';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
      if (cell.unit) {
        const team = this.ownerColors.get(cell.unit.owner) ?? '#212529';
        const uy = cell.building ? y + 10 : y + 3;
        drawUnitFigurine(ctx, x, uy, cell.unit.rank as UnitRank, cell.unit.moved, team, {
          count: cell.unit.count ?? 1,
        });
      }
    }
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

function overlayStateKey(game: Game): string {
  return `${game.ui.mode}|${game.ui.selectedKey}|${game.ui.hoverKey}|${game.terrainRevision}|${game.unitsRevision}`;
}

function pathHex(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.beginPath();
  ctx.moveTo(x + HEX_OX[0], y + HEX_OY[0]);
  for (let i = 1; i < 6; i++) ctx.lineTo(x + HEX_OX[i], y + HEX_OY[i]);
  ctx.closePath();
}
