import { BUILDING_PROTECTION, UNIT_FIGURE_DRAW_MAX, houseRankFromKind, isHouseBuilding } from './constants';
import type { BuildingKind, UnitRank } from './types';

/** Highly detailed isometric 3D canvas figurines. */

function shade(hex: string, amt: number): string {
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

function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, a = 0.3): void {
  ctx.save();
  ctx.fillStyle = `rgba(0,0,0,${a})`;
  ctx.beginPath();
  ctx.ellipse(x, y + 1, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function isoBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  d: number,
  h: number,
  color: string,
  opts: { outline?: boolean; topAmt?: number; leftAmt?: number; rightAmt?: number } = {},
): void {
  const hw = w / 2;
  const hd = d / 2;
  const top = shade(color, opts.topAmt ?? 42);
  const left = shade(color, opts.leftAmt ?? -32);
  const right = shade(color, opts.rightAmt ?? -10);

  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.moveTo(x, y - h);
  ctx.lineTo(x + hw, y - h + hd * 0.55);
  ctx.lineTo(x, y - h + hd * 1.1);
  ctx.lineTo(x - hw, y - h + hd * 0.55);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = left;
  ctx.beginPath();
  ctx.moveTo(x - hw, y - h + hd * 0.55);
  ctx.lineTo(x, y - h + hd * 1.1);
  ctx.lineTo(x, y + hd * 1.1);
  ctx.lineTo(x - hw, y + hd * 0.55);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = right;
  ctx.beginPath();
  ctx.moveTo(x + hw, y - h + hd * 0.55);
  ctx.lineTo(x, y - h + hd * 1.1);
  ctx.lineTo(x, y + hd * 1.1);
  ctx.lineTo(x + hw, y + hd * 0.55);
  ctx.closePath();
  ctx.fill();

  if (opts.outline !== false) {
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 0.55;
    ctx.beginPath();
    ctx.moveTo(x, y - h);
    ctx.lineTo(x + hw, y - h + hd * 0.55);
    ctx.lineTo(x, y - h + hd * 1.1);
    ctx.lineTo(x - hw, y - h + hd * 0.55);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - hw, y - h + hd * 0.55);
    ctx.lineTo(x - hw, y + hd * 0.55);
    ctx.moveTo(x + hw, y - h + hd * 0.55);
    ctx.lineTo(x + hw, y + hd * 0.55);
    ctx.moveTo(x, y - h + hd * 1.1);
    ctx.lineTo(x, y + hd * 1.1);
    ctx.stroke();
  }
}

function isoCylinder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  h: number,
  color: string,
): void {
  const top = shade(color, 38);
  const side = shade(color, -20);
  ctx.fillStyle = side;
  ctx.beginPath();
  ctx.moveTo(x - rx, y);
  ctx.lineTo(x - rx, y - h);
  ctx.ellipse(x, y - h, rx, ry, 0, Math.PI, 0, true);
  ctx.lineTo(x + rx, y);
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI, false);
  ctx.closePath();
  ctx.fill();

  // Side highlight strip
  ctx.strokeStyle = shade(color, 25);
  ctx.lineWidth = Math.max(1, rx * 0.18);
  ctx.beginPath();
  ctx.moveTo(x - rx * 0.45, y - 1);
  ctx.lineTo(x - rx * 0.45, y - h + 1);
  ctx.stroke();

  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.ellipse(x, y - h, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 0.55;
  ctx.stroke();

  // Specular on top
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath();
  ctx.ellipse(x - rx * 0.25, y - h - ry * 0.15, rx * 0.35, ry * 0.28, -0.4, 0, Math.PI * 2);
  ctx.fill();
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  w = 1,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawBadge(ctx: CanvasRenderingContext2D, x: number, y: number, rank: number): void {
  const bx = x + 13;
  const by = y - 15;
  shadow(ctx, bx, by + 7, 5.5, 2.2, 0.35);
  const grad = ctx.createRadialGradient(bx - 1.5, by - 2.5, 0.5, bx, by, 7.5);
  grad.addColorStop(0, '#fff8e1');
  grad.addColorStop(0.35, '#ffd43b');
  grad.addColorStop(0.75, '#f08c00');
  grad.addColorStop(1, '#e67700');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(bx, by, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1.1;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(bx, by, 5.2, -2.2, -0.4);
  ctx.stroke();
  ctx.fillStyle = '#212529';
  ctx.font = 'bold 10px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(rank), bx, by + 0.5);
}

export function drawUnitFigurine(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rank: UnitRank,
  moved: boolean,
  teamColor: string,
  opts: { compact?: boolean; count?: number } = {},
): void {
  ctx.save();
  ctx.globalAlpha = moved ? 0.55 : 1;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'low';

  const count = Math.max(1, opts.count ?? 1);
  const figures = Math.min(count, UNIT_FIGURE_DRAW_MAX);
  const offs = stackOffsets(figures);

  if (rank === 3) {
    drawGunTruck(ctx, x + 4, y + 6, teamColor);
  }

  for (const o of offs) {
    const fx = x + o.dx;
    const fy = y + o.dy;
    if (rank === 1) drawMilitia(ctx, fx, fy, teamColor);
    else if (rank === 2) drawSoldier(ctx, fx, fy, teamColor);
    else if (rank === 3) drawSpecOps(ctx, fx, fy, teamColor);
    else drawTank(ctx, fx, fy, teamColor);
  }

  drawBadge(ctx, x, y, rank);
  // Always show stack size ×N
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.arc(x + 12, y + 10, 7.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 9px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`×${count}`, x + 12, y + 10.5);
  ctx.restore();
}

function stackOffsets(n: number): { dx: number; dy: number }[] {
  if (n <= 1) return [{ dx: 0, dy: 0 }];
  if (n === 2) return [{ dx: -7, dy: 2 }, { dx: 7, dy: -2 }];
  if (n === 3) return [{ dx: -9, dy: 3 }, { dx: 0, dy: -3 }, { dx: 9, dy: 3 }];
  if (n === 4) {
    return [
      { dx: -9, dy: -2 },
      { dx: 9, dy: -2 },
      { dx: -9, dy: 6 },
      { dx: 9, dy: 6 },
    ];
  }
  return [
    { dx: -10, dy: 4 },
    { dx: -5, dy: -3 },
    { dx: 0, dy: 6 },
    { dx: 5, dy: -3 },
    { dx: 10, dy: 4 },
  ];
}

/** Fast LOD icon when zoomed out or during pan/zoom. */
export function drawUnitLod(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rank: UnitRank,
  moved: boolean,
  teamColor: string,
): void {
  ctx.save();
  ctx.globalAlpha = moved ? 0.5 : 1;
  if (rank === 4) {
    ctx.fillStyle = teamColor;
    ctx.fillRect(x - 10, y - 4, 20, 10);
    ctx.fillStyle = '#495057';
    ctx.fillRect(x + 2, y - 6, 12, 4);
  } else if (rank === 3) {
    ctx.fillStyle = '#868e96';
    ctx.fillRect(x - 8, y + 2, 16, 8);
    ctx.fillStyle = teamColor;
    ctx.beginPath();
    ctx.arc(x - 4, y - 2, 4, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = teamColor;
    ctx.beginPath();
    ctx.arc(x, y - 2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x - 2.5, y + 2, 5, 7);
    if (rank === 2) {
      ctx.beginPath();
      ctx.arc(x - 7, y, 3.5, 0, Math.PI * 2);
      ctx.arc(x + 7, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  drawBadge(ctx, x, y - 2, rank);
  ctx.restore();
}


type UnitSpriteId = 'militia' | 'soldier' | 'specops' | 'guntruck' | 't90';
type BuildingSpriteId =
  | 'castle'
  | 'farm'
  | 'tower'
  | 'strongTower'
  | 'house1'
  | 'house2'
  | 'house3'
  | 'house4';
type TerrainSpriteId = 'forest';

const UNIT_SPRITE_SRC: Record<UnitSpriteId, string> = {
  militia: '/militia.png',
  soldier: '/soldier.png',
  specops: '/specops.png',
  guntruck: '/guntruck.png',
  t90: '/t90-tank.png',
};

const BUILDING_SPRITE_SRC: Record<BuildingSpriteId, string> = {
  castle: '/castle.png',
  farm: '/farm.png',
  tower: '/firepoint.png',
  strongTower: '/defense-line.png',
  house1: '/house1.png',
  house2: '/house2.png',
  house3: '/house3.png',
  house4: '/house4.png',
};

const TERRAIN_SPRITE_SRC: Record<TerrainSpriteId, string> = {
  forest: '/forest.png',
};

/** Map draw size for isometric building portraits. */
const BUILDING_DRAW_SIZE: Record<BuildingSpriteId, number> = {
  castle: 44,
  farm: 40,
  tower: 47, // ~10% smaller than previous 52
  strongTower: 42,
  house1: 40,
  house2: 42,
  house3: 44,
  house4: 46,
};

const FOREST_DRAW_SIZE = 36;

/** Draw size covering ~90% of a hex (HEX_SIZE≈48 → diameter≈96). */
export const FOREST_HEX_FILL_SIZE = 86;

interface SpriteState {
  img: HTMLImageElement | null;
  failed: boolean;
}

const spriteState: Record<UnitSpriteId, SpriteState> = {
  militia: { img: null, failed: false },
  soldier: { img: null, failed: false },
  specops: { img: null, failed: false },
  guntruck: { img: null, failed: false },
  t90: { img: null, failed: false },
};

const buildingSpriteState: Record<BuildingSpriteId, SpriteState> = {
  castle: { img: null, failed: false },
  farm: { img: null, failed: false },
  tower: { img: null, failed: false },
  strongTower: { img: null, failed: false },
  house1: { img: null, failed: false },
  house2: { img: null, failed: false },
  house3: { img: null, failed: false },
  house4: { img: null, failed: false },
};

const terrainSpriteState: Record<TerrainSpriteId, SpriteState> = {
  forest: { img: null, failed: false },
};

const unitSpriteReadyListeners: Array<() => void> = [];

function notifyUnitSpritesMaybeReady(): void {
  if (!allSpritesSettled()) return;
  const listeners = unitSpriteReadyListeners.splice(0);
  for (const fn of listeners) fn();
}

function allSpritesSettled(): boolean {
  const unitsOk = (Object.keys(UNIT_SPRITE_SRC) as UnitSpriteId[]).every((id) => {
    const s = spriteState[id];
    if (s.failed) return true;
    return !!s.img && s.img.complete && s.img.naturalWidth > 0;
  });
  const buildingsOk = (Object.keys(BUILDING_SPRITE_SRC) as BuildingSpriteId[]).every((id) => {
    const s = buildingSpriteState[id];
    if (s.failed) return true;
    return !!s.img && s.img.complete && s.img.naturalWidth > 0;
  });
  const terrainOk = (Object.keys(TERRAIN_SPRITE_SRC) as TerrainSpriteId[]).every((id) => {
    const s = terrainSpriteState[id];
    if (s.failed) return true;
    return !!s.img && s.img.complete && s.img.naturalWidth > 0;
  });
  return unitsOk && buildingsOk && terrainOk;
}

function loadSprite(
  state: SpriteState | undefined,
  src: string,
): HTMLImageElement | null {
  if (!state) return null;
  if (state.failed) return null;
  if (typeof Image === 'undefined') return null;
  if (!state.img) {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => notifyUnitSpritesMaybeReady();
    img.onerror = () => {
      state.failed = true;
      notifyUnitSpritesMaybeReady();
    };
    img.src = src;
    state.img = img;
  }
  if (state.img.complete && state.img.naturalWidth > 0) return state.img;
  return null;
}

function getUnitSprite(id: UnitSpriteId): HTMLImageElement | null {
  return loadSprite(spriteState[id], UNIT_SPRITE_SRC[id]);
}

function getBuildingSprite(id: BuildingSpriteId): HTMLImageElement | null {
  return loadSprite(buildingSpriteState[id], BUILDING_SPRITE_SRC[id]);
}

function getTerrainSprite(id: TerrainSpriteId): HTMLImageElement | null {
  return loadSprite(terrainSpriteState[id], TERRAIN_SPRITE_SRC[id]);
}

/** Start loading unit/building photo sprites; `onReady` fires when all have loaded (or failed). */
export function preloadUnitSprites(onReady?: () => void): void {
  for (const id of Object.keys(UNIT_SPRITE_SRC) as UnitSpriteId[]) getUnitSprite(id);
  for (const id of Object.keys(BUILDING_SPRITE_SRC) as BuildingSpriteId[]) getBuildingSprite(id);
  for (const id of Object.keys(TERRAIN_SPRITE_SRC) as TerrainSpriteId[]) getTerrainSprite(id);
  if (!onReady) return;
  if (allSpritesSettled()) onReady();
  else unitSpriteReadyListeners.push(onReady);
}

function drawTeamMark(ctx: CanvasRenderingContext2D, x: number, y: number, teamColor: string, w = 6): void {
  ctx.fillStyle = teamColor;
  ctx.fillRect(x - w / 2, y, w, 2.4);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 0.6;
  ctx.strokeRect(x - w / 2, y, w, 2.4);
}

function drawPhotoUnit(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  id: UnitSpriteId,
  size: number,
  teamColor: string,
  opts: { shadowRx?: number; shadowRy?: number; markY?: number; markW?: number } = {},
): void {
  const shadowRx = opts.shadowRx ?? size * 0.28;
  const shadowRy = opts.shadowRy ?? size * 0.1;
  shadow(ctx, x, y + size * 0.34, shadowRx, shadowRy, 0.32);
  const img = getUnitSprite(id);
  if (img) {
    ctx.drawImage(img, x - size / 2, y - size * 0.58, size, size);
    drawTeamMark(ctx, x, opts.markY ?? y + size * 0.3, teamColor, opts.markW ?? Math.max(5, size * 0.22));
  } else {
    // Compact geometric fallback until the photo loads
    isoBox(ctx, x - 1.4, y + 5, 2.2, 2, 3, '#495057');
    isoBox(ctx, x + 1.4, y + 5, 2.2, 2, 3, '#495057');
    isoBox(ctx, x, y + 0.5, 6, 4, 8, teamColor);
    isoCylinder(ctx, x, y - 7, 2.5, 1.5, 3, '#e8c39e');
  }
}


function drawGunTruck(ctx: CanvasRenderingContext2D, x: number, y: number, teamColor: string): void {
  const size = 34;
  shadow(ctx, x, y + 10, 14, 4, 0.34);
  const img = getUnitSprite('guntruck');
  if (img) {
    ctx.drawImage(img, x - size / 2, y - size * 0.45, size, size);
    drawTeamMark(ctx, x - 4, y + 10, teamColor, 10);
  } else {
    isoBox(ctx, x, y + 3, 18, 10, 5, '#868e96');
    isoBox(ctx, x - 4, y - 1, 8, 8, 5, shade(teamColor, -20));
    isoBox(ctx, x + 8, y - 2, 8, 2, 2, '#495057');
  }
}

/** Rank 1 — militia photo figurine. */
function drawMilitia(ctx: CanvasRenderingContext2D, x: number, y: number, teamColor: string): void {
  drawPhotoUnit(ctx, x, y, 'militia', 26, teamColor);
}

/** Rank 2 — soldier photo figurine. */
function drawSoldier(ctx: CanvasRenderingContext2D, x: number, y: number, teamColor: string): void {
  drawPhotoUnit(ctx, x, y, 'soldier', 26, teamColor);
}

/** Rank 3 — special forces photo figurine. */
function drawSpecOps(ctx: CanvasRenderingContext2D, x: number, y: number, teamColor: string): void {
  drawPhotoUnit(ctx, x, y, 'specops', 26, teamColor);
}

/** Rank 4 — T-90 main battle tank (photo sprite). */
function drawTank(ctx: CanvasRenderingContext2D, x: number, y: number, teamColor: string): void {
  shadow(ctx, x, y + 10, 16, 5, 0.38);
  const img = getUnitSprite('t90');
  if (img) {
    const size = 44;
    ctx.drawImage(img, x - size / 2, y - size / 2 - 3, size, size);
    drawTeamMark(ctx, x - 2, y + 8, teamColor, 10);
  } else {
    isoBox(ctx, x, y + 3, 22, 12, 6, shade(teamColor, -20));
    isoBox(ctx, x, y - 2, 12, 9, 6, teamColor);
    isoBox(ctx, x + 10, y - 4, 14, 2.2, 2, '#868e96');
  }
}

export function drawBuildingFigurine(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  kind: BuildingKind,
  trainLeft: number | null,
): void {
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium';
  if (!drawBuildingPhoto(ctx, x, y, kind as BuildingSpriteId, trainLeft)) {
    // Geometric fallbacks if photo sprites are still loading / missing
    if (kind === 'castle') drawCapital(ctx, x, y);
    else if (kind === 'farm') drawFarm(ctx, x, y);
    else if (kind === 'tower') drawTower(ctx, x, y, false);
    else if (kind === 'strongTower') drawTower(ctx, x, y, true);
    else if (isHouseBuilding(kind)) {
      const rank = houseRankFromKind(kind)!;
      if (rank === 1) drawCottage(ctx, x, y, trainLeft);
      else if (rank === 2) drawBarracksBuilding(ctx, x, y, trainLeft);
      else if (rank === 3) drawHeadquarters(ctx, x, y, trainLeft);
      else drawMilitaryFactory(ctx, x, y, trainLeft);
    }
  }
  ctx.restore();
}

/**
 * Forest cover for a hex. Pass `size` ≈ hex diameter to fill the cell;
 * caller should clip to the hex path when filling the whole tile.
 */
export function drawForestFigurine(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number = FOREST_DRAW_SIZE,
): void {
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium';
  const img = getTerrainSprite('forest');
  if (img) {
    // No drop shadow when filling a hex — it muddies clipped edges
    if (size <= FOREST_DRAW_SIZE + 4) {
      shadow(ctx, x, y + size * 0.28, size * 0.42, size * 0.14, 0.3);
    }
    ctx.drawImage(img, x - size / 2, y - size * 0.52, size, size);
  } else {
    drawForestFallback(ctx, x, y, size);
  }
  ctx.restore();
}

function drawForestFallback(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  if (size > 50) {
    ctx.fillStyle = 'rgba(34, 92, 48, 0.72)';
    ctx.beginPath();
    ctx.ellipse(x, y + size * 0.02, size * 0.46, size * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const scale = Math.max(0.7, size / 48);
  const crowns: [number, number, number][] = [
    [0, -6, 7],
    [-10, -2, 6],
    [10, -3, 6.2],
    [-5, 4, 5],
    [6, 5, 5.2],
    [0, 2, 5.5],
  ];
  for (const [dx, dy, r] of crowns) {
    ctx.fillStyle = '#6b4226';
    const tw = 1.2 * scale;
    ctx.fillRect(x + dx * scale - tw / 2, y + dy * scale, tw, 6 * scale);
    ctx.fillStyle = '#2b8a3e';
    ctx.beginPath();
    ctx.arc(x + dx * scale, y + (dy - 5) * scale, r * scale, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBuildingPhoto(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  id: BuildingSpriteId,
  trainLeft: number | null,
): boolean {
  const img = getBuildingSprite(id);
  if (!img) return false;
  const size = BUILDING_DRAW_SIZE[id];
  shadow(ctx, x, y + 11, size * 0.4, size * 0.13, 0.34);
  ctx.drawImage(img, x - size / 2, y - size * 0.58, size, size);

  if (id === 'tower' || id === 'strongTower') {
    const prot = BUILDING_PROTECTION[id];
    ctx.font = 'bold 10px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeText(String(prot), x, y + 10);
    ctx.fillStyle = '#fff';
    ctx.fillText(String(prot), x, y + 10);
  }

  if (isHouseBuilding(id) && trainLeft !== null) {
    drawTrainBadge(ctx, x + size * 0.32, y - size * 0.42, trainLeft);
  }
  return true;
}

function drawCapital(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  shadow(ctx, x, y + 9, 14, 4.5, 0.35);
  // Plaza
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.ellipse(x, y + 7, 14, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Main keep base
  isoBox(ctx, x, y + 4, 22, 15, 9, '#d4cbbd');
  drawBrickLines(ctx, x, y + 4, 22, 9, '#b8ae9e');

  // Side towers
  for (const dx of [-8, 8]) {
    isoBox(ctx, x + dx, y - 2, 8, 8, 12, '#ebe4d8');
    // Battlements
    for (const bx of [-2.2, 0, 2.2]) {
      isoBox(ctx, x + dx + bx, y - 13.5, 2.4, 2.4, 2.6, '#cfc5b5');
    }
    // Arrow slit
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(x + dx - 0.5, y - 6, 1, 3.5);
  }

  // Central keep
  isoBox(ctx, x, y - 6, 10, 10, 16, '#f1ece3');
  drawBrickLines(ctx, x, y - 6, 10, 16, '#d5cfc3');
  for (const bx of [-3, 0, 3]) {
    isoBox(ctx, x + bx, y - 21, 2.8, 2.8, 2.8, '#c2b8a8');
  }

  // Windows
  for (const [wx, wy] of [
    [-2.5, -12],
    [2.5, -12],
    [0, -8],
  ] as const) {
    isoBox(ctx, x + wx, y + wy, 2.2, 1.8, 2.8, '#1c3a4a');
    ctx.fillStyle = 'rgba(255,220,120,0.35)';
    ctx.fillRect(x + wx - 0.6, y + wy - 2.2, 1.2, 1.5);
  }

  // Gatehouse
  isoBox(ctx, x, y + 5, 7, 5, 6, '#cfc5b5');
  ctx.fillStyle = '#3d2914';
  ctx.beginPath();
  ctx.moveTo(x - 2.8, y + 7);
  ctx.quadraticCurveTo(x, y + 1.5, x + 2.8, y + 7);
  ctx.lineTo(x + 2.8, y + 8);
  ctx.lineTo(x - 2.8, y + 8);
  ctx.closePath();
  ctx.fill();
  // Portcullis lines
  for (let i = -2; i <= 2; i++) {
    drawLine(ctx, x + i * 1.1, y + 3.5, x + i * 1.1, y + 7.5, '#1a1a1a', 0.7);
  }

  // Flag
  drawLine(ctx, x, y - 22, x, y - 32, '#6b4226', 1.5);
  ctx.fillStyle = '#c92a2a';
  ctx.beginPath();
  ctx.moveTo(x, y - 32);
  ctx.lineTo(x + 10, y - 28.5);
  ctx.lineTo(x, y - 25);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(x + 2, y - 30.5);
  ctx.lineTo(x + 6.5, y - 28.8);
  ctx.lineTo(x + 2, y - 27.2);
  ctx.closePath();
  ctx.fill();
}

function drawBrickLines(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 0.5;
  for (let i = 1; i < 5; i++) {
    const yy = y - (h * i) / 5;
    ctx.beginPath();
    ctx.moveTo(x - w * 0.28, yy);
    ctx.lineTo(x + w * 0.28, yy + w * 0.08);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFarm(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  shadow(ctx, x, y + 9, 13, 4, 0.32);

  // Field ellipse with crop rows
  const field = ctx.createRadialGradient(x, y + 6, 2, x, y + 6, 13);
  field.addColorStop(0, '#8ce99a');
  field.addColorStop(1, '#2f9e44');
  ctx.fillStyle = field;
  ctx.beginPath();
  ctx.ellipse(x, y + 7, 13, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#1b7a33';
  ctx.lineWidth = 0.7;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.ellipse(x, y + 7, 12, 3.6 + i * 0.12, 0, 0.25, Math.PI - 0.25);
    ctx.stroke();
  }
  // Tiny crop stalks
  ctx.strokeStyle = '#94d82d';
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 10; i++) {
    const cx = x - 9 + i * 2;
    ctx.beginPath();
    ctx.moveTo(cx, y + 6.5);
    ctx.lineTo(cx + 0.4, y + 4.2);
    ctx.stroke();
  }

  // Barn body with plank look
  isoBox(ctx, x - 2, y + 1, 15, 11, 9, '#d9480f');
  for (let i = 0; i < 5; i++) {
    drawLine(ctx, x - 7, y - 5 + i * 2, x + 3.5, y - 2 + i * 2, '#a61e00', 0.55);
  }
  // Roof
  ctx.fillStyle = '#f08c00';
  ctx.beginPath();
  ctx.moveTo(x - 10, y - 8);
  ctx.lineTo(x - 2, y - 16);
  ctx.lineTo(x + 6, y - 8);
  ctx.lineTo(x + 6, y - 6);
  ctx.lineTo(x - 2, y - 13);
  ctx.lineTo(x - 10, y - 6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e8590c';
  ctx.beginPath();
  ctx.moveTo(x + 6, y - 8);
  ctx.lineTo(x - 2, y - 16);
  ctx.lineTo(x + 6.5, y - 11);
  ctx.closePath();
  ctx.fill();
  // Roof ridge tiles
  for (let i = 0; i < 4; i++) {
    isoBox(ctx, x - 7 + i * 2.5, y - 9 - i * 1.5, 2, 1.5, 0.8, '#fd7e14');
  }

  // Door + loft window
  isoBox(ctx, x - 2, y + 2.5, 4, 2.5, 5.5, '#5c3d1e');
  isoBox(ctx, x - 2, y + 1.5, 1.2, 1, 1.2, '#c9a227');
  isoBox(ctx, x - 2, y - 6, 3, 2, 2.5, '#fff3bf');
  // Hay peeking
  ctx.fillStyle = '#ffd43b';
  ctx.beginPath();
  ctx.moveTo(x - 3.2, y - 4.5);
  ctx.lineTo(x - 2, y - 6.5);
  ctx.lineTo(x - 0.8, y - 4.5);
  ctx.fill();

  // Silo
  isoCylinder(ctx, x + 9.5, y + 3, 3.3, 1.8, 14, '#adb5bd');
  for (const hy of [3, 6, 9]) {
    ctx.strokeStyle = '#868e96';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(x + 9.5, y + 3 - hy, 3.3, 1.8, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  isoBox(ctx, x + 9.5, y - 11, 3, 2.5, 2, '#868e96');

  // Fence posts
  for (const fx of [-12, -10, 10, 12]) {
    isoBox(ctx, x + fx, y + 6, 1.2, 1.2, 3.5, '#8b6914');
  }
  drawLine(ctx, x - 12, y + 4.5, x - 10, y + 4.5, '#8b6914', 1);
  drawLine(ctx, x + 10, y + 4.5, x + 12, y + 4.5, '#8b6914', 1);
}

function drawTower(ctx: CanvasRenderingContext2D, x: number, y: number, strong: boolean): void {
  shadow(ctx, x, y + 9, 9, 3.2, 0.34);
  const body = strong ? '#343a40' : '#868e96';
  const trim = strong ? '#212529' : '#495057';

  // Base plinth
  isoBox(ctx, x, y + 5, 14, 11, 5, shade(body, -15));
  drawBrickLines(ctx, x, y + 5, 14, 5, shade(body, -35));

  // Shaft
  isoCylinder(ctx, x, y - 1, 5.5, 3.2, 16, body);
  // Vertical seams
  for (const a of [-0.6, 0.2, 0.9]) {
    drawLine(
      ctx,
      x + Math.cos(a) * 4.2,
      y - 1,
      x + Math.cos(a) * 4.2,
      y - 15,
      shade(body, -40),
      0.6,
    );
  }

  // Ring bands
  for (const hy of [5, 10]) {
    ctx.strokeStyle = shade(body, 20);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(x, y - 1 - hy, 5.6, 3.3, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Arrow slits
  for (const [ax, ay] of [
    [-2, -8],
    [2, -8],
    [0, -12],
  ] as const) {
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(x + ax - 0.45, y + ay, 0.9, 2.8);
  }

  // Turret head
  isoBox(ctx, x, y - 17, 15, 11, 5, trim);
  for (const bx of [-5, -2.5, 0, 2.5, 5]) {
    isoBox(ctx, x + bx, y - 21.5, 2.6, 2.6, 2.8, shade(trim, 15));
  }

  if (strong) {
    // Radar / comms
    isoCylinder(ctx, x, y - 23, 2.2, 1.3, 5, '#c92a2a');
    ctx.fillStyle = '#fa5252';
    ctx.beginPath();
    ctx.arc(x, y - 28.5, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(250,82,82,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y - 28.5, 4.5, 0, Math.PI * 2);
    ctx.stroke();
    // Gun embrasure
    isoBox(ctx, x + 6, y - 19, 5, 2, 1.5, '#111');
  } else {
    // Signal flag
    drawLine(ctx, x, y - 22, x, y - 28, '#adb5bd', 1.2);
    ctx.fillStyle = '#fab005';
    ctx.beginPath();
    ctx.moveTo(x, y - 28);
    ctx.lineTo(x + 7, y - 25.5);
    ctx.lineTo(x, y - 23);
    ctx.closePath();
    ctx.fill();
  }

  const prot = BUILDING_PROTECTION[strong ? 'strongTower' : 'tower'];
  ctx.font = 'bold 10px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.strokeText(String(prot), x, y + 2);
  ctx.fillStyle = '#fff';
  ctx.fillText(String(prot), x, y + 2);
}

function drawTrainBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  trainLeft: number | null,
): void {
  if (trainLeft === null) return;
  shadow(ctx, x, y + 6, 5, 2, 0.3);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x, y, 7.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#c92a2a';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#c92a2a';
  ctx.font = 'bold 10px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(trainLeft), x, y + 0.5);
}

/** Rank 1 — cottage / дом. */
function drawCottage(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  trainLeft: number | null,
): void {
  const accent = '#94d82d';
  const w = 15;
  const wallH = 9.5;
  shadow(ctx, x, y + 8, w * 0.55, 3.2, 0.33);
  isoBox(ctx, x, y + 5, w + 2, w * 0.75, 2.5, '#868e96');
  isoBox(ctx, x, y + 3, w, w * 0.7, wallH, '#f8f1e7');
  drawBrickLines(ctx, x, y + 3, w, wallH, '#e0d6c8');
  isoBox(ctx, x - 3, y - 1, 2.8, 2.2, 2.6, '#1c3a4a');
  isoBox(ctx, x + 3, y - 1, 2.8, 2.2, 2.6, '#1c3a4a');
  ctx.fillStyle = 'rgba(255,236,153,0.55)';
  ctx.fillRect(x - 3.5, y - 2.5, 1.2, 1.2);
  ctx.fillRect(x + 2.5, y - 2.5, 1.2, 1.2);
  isoBox(ctx, x, y + 4, 3.6, 2.6, 5, '#5c4033');
  isoBox(ctx, x + 1, y + 2.2, 0.7, 0.7, 0.7, '#c9a227');
  const roofTop = y + 3 - wallH;
  ctx.fillStyle = shade(accent, 18);
  ctx.beginPath();
  ctx.moveTo(x - w / 2 - 2.5, roofTop + 2);
  ctx.lineTo(x, roofTop - 8);
  ctx.lineTo(x + w / 2 + 2.5, roofTop + 2);
  ctx.lineTo(x, roofTop + 5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = shade(accent, -28);
  ctx.beginPath();
  ctx.moveTo(x + w / 2 + 2.5, roofTop + 2);
  ctx.lineTo(x, roofTop - 8);
  ctx.lineTo(x + w / 2 - 1, roofTop + 6);
  ctx.closePath();
  ctx.fill();
  isoBox(ctx, x + w * 0.28, roofTop - 2, 3, 2.8, 6, shade(accent, -35));
  ctx.fillStyle = '#212529';
  ctx.font = 'bold 8px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('H1', x, y + 9);
  drawTrainBadge(ctx, x + w / 2 + 3, roofTop - 4, trainLeft);
}

/** Rank 2 — barracks / казарма. */
function drawBarracksBuilding(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  trainLeft: number | null,
): void {
  shadow(ctx, x, y + 9, 14, 4, 0.34);
  // Long barrack block
  isoBox(ctx, x, y + 4, 22, 12, 8, '#5c6b5a');
  drawBrickLines(ctx, x, y + 4, 22, 8, '#3d4a3c');
  // Camo roof
  isoBox(ctx, x, y - 4, 24, 13, 3.5, '#2f4a34');
  for (let i = 0; i < 5; i++) {
    isoBox(ctx, x - 8 + i * 4, y - 5.5, 3.2, 2.5, 1.2, i % 2 ? '#3d5a40' : '#2b8a3e');
  }
  // Door arches
  for (const dx of [-6, 0, 6]) {
    isoBox(ctx, x + dx, y + 4, 4, 2.5, 5, '#2b2b2b');
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.ellipse(x + dx, y + 5.5, 1.6, 2.2, 0, Math.PI, 0);
    ctx.fill();
  }
  // Windows strip
  for (let i = 0; i < 6; i++) {
    isoBox(ctx, x - 9 + i * 3.5, y - 0.5, 2.2, 1.8, 2, '#1c3a4a');
  }
  // Flag pole
  drawLine(ctx, x + 10, y - 7, x + 10, y - 16, '#adb5bd', 1.3);
  ctx.fillStyle = '#1971c2';
  ctx.beginPath();
  ctx.moveTo(x + 10, y - 16);
  ctx.lineTo(x + 17, y - 13.5);
  ctx.lineTo(x + 10, y - 11);
  ctx.closePath();
  ctx.fill();
  // Sandbags
  for (const dx of [-11, -9, 9, 11]) {
    isoBox(ctx, x + dx, y + 6.5, 2.4, 2, 1.8, '#c2a878');
  }
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 8px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('КАЗ', x, y - 8);
  drawTrainBadge(ctx, x + 13, y - 12, trainLeft);
}

/** Rank 3 — military HQ / штаб. */
function drawHeadquarters(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  trainLeft: number | null,
): void {
  shadow(ctx, x, y + 9, 13, 4.2, 0.35);
  // Base podium
  isoBox(ctx, x, y + 5, 20, 14, 4, '#495057');
  // Main HQ body
  isoBox(ctx, x, y + 1, 16, 12, 12, '#dee2e6');
  drawBrickLines(ctx, x, y + 1, 16, 12, '#adb5bd');
  // Glass facade
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      isoBox(ctx, x - 4 + col * 4, y - 2 - row * 3.2, 3, 2.2, 2.4, '#1c7ed6');
      ctx.fillStyle = 'rgba(116,192,252,0.45)';
      ctx.fillRect(x - 4.5 + col * 4, y - 3.5 - row * 3.2, 1.5, 1.2);
    }
  }
  // Command tower
  isoBox(ctx, x + 1, y - 12, 8, 7, 8, '#868e96');
  isoBox(ctx, x + 1, y - 19, 9, 8, 3, '#343a40');
  // Antenna / dishes
  isoCylinder(ctx, x + 1, y - 22, 2.5, 1.4, 2, '#adb5bd');
  drawLine(ctx, x + 1, y - 23, x + 1, y - 30, '#ced4da', 1.4);
  ctx.strokeStyle = 'rgba(116,192,252,0.5)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(x + 1, y - 27, 3.5, 0, Math.PI * 2);
  ctx.stroke();
  // Entrance canopy
  isoBox(ctx, x - 4, y + 2, 6, 4, 2, '#212529');
  isoBox(ctx, x - 4, y + 4, 3.5, 2.5, 4, '#1a1a1a');
  // Star emblem
  ctx.fillStyle = '#fab005';
  ctx.beginPath();
  const sx = x + 5;
  const sy = y - 14;
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    const r = 2.4;
    const px = sx + Math.cos(a) * r;
    const py = sy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#212529';
  ctx.font = 'bold 8px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('ШТАБ', x, y + 9);
  drawTrainBadge(ctx, x + 12, y - 18, trainLeft);
}

/** Rank 4 — military factory / завод. */
function drawMilitaryFactory(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  trainLeft: number | null,
): void {
  shadow(ctx, x, y + 9, 15, 4.5, 0.36);
  // Factory floor
  isoBox(ctx, x, y + 5, 24, 14, 5, '#495057');
  // Main hangar
  isoBox(ctx, x - 2, y + 1, 18, 12, 10, '#868e96');
  // Hangar roof (sawtooth)
  for (let i = 0; i < 3; i++) {
    const hx = x - 7 + i * 5.5;
    ctx.fillStyle = '#343a40';
    ctx.beginPath();
    ctx.moveTo(hx - 3, y - 8);
    ctx.lineTo(hx, y - 14);
    ctx.lineTo(hx + 3, y - 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#1c7ed6';
    ctx.beginPath();
    ctx.moveTo(hx, y - 14);
    ctx.lineTo(hx + 3, y - 8);
    ctx.lineTo(hx + 2.2, y - 8);
    ctx.closePath();
    ctx.fill();
  }
  // Smokestacks
  isoCylinder(ctx, x + 9, y - 2, 2.2, 1.3, 16, '#495057');
  isoCylinder(ctx, x + 12.5, y, 1.8, 1.1, 12, '#343a40');
  ctx.fillStyle = 'rgba(120,120,120,0.4)';
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.ellipse(x + 9 + i * 0.6, y - 20 - i * 2.5, 2 + i * 0.5, 1.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Big hangar door
  isoBox(ctx, x - 3, y + 3, 8, 3, 7, '#212529');
  for (let i = 0; i < 4; i++) {
    drawLine(ctx, x - 5.5 + i * 1.8, y - 2, x - 5.5 + i * 1.8, y + 5, '#343a40', 0.8);
  }
  // Crane
  isoBox(ctx, x + 5, y - 6, 2, 2, 10, '#fab005');
  isoBox(ctx, x + 2, y - 15, 12, 2, 1.5, '#f08c00');
  drawLine(ctx, x - 2, y - 14, x - 2, y - 6, '#adb5bd', 1);
  isoBox(ctx, x - 2, y - 6, 2.5, 2.5, 2, '#868e96');
  // Tank hull on lot
  isoBox(ctx, x - 8, y + 6, 6, 4, 2.5, '#2f9e44');
  isoBox(ctx, x - 6, y + 4.5, 3, 2.5, 1.8, '#1a1a1a');
  ctx.fillStyle = '#ffd43b';
  ctx.font = 'bold 8px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('ЗАВОД', x, y - 9);
  drawTrainBadge(ctx, x + 14, y - 16, trainLeft);
}
