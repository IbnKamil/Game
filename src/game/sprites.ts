import { BUILDING_PROTECTION, UNIT_FIGURE_COUNT, houseRankFromKind, isHouseBuilding } from './constants';
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
  opts: { compact?: boolean } = {},
): void {
  ctx.save();
  ctx.globalAlpha = moved ? 0.55 : 1;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = opts.compact ? 'medium' : 'high';

  if (rank === 1) drawGroup(ctx, x, y, UNIT_FIGURE_COUNT[1], teamColor, drawMilitia, 0.85);
  else if (rank === 2) drawSoldierSquad(ctx, x, y, teamColor, opts.compact === true);
  else if (rank === 3) drawSpecOpsSquad(ctx, x, y, teamColor);
  else drawTank(ctx, x, y, teamColor);

  drawBadge(ctx, x, y, rank);
  ctx.restore();
}

/** Fast LOD icon when zoomed out. */
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
  shadow(ctx, x, y + 4, 8, 3, 0.25);
  if (rank === 4) {
    isoBox(ctx, x, y + 1, 14, 8, 5, teamColor);
    isoBox(ctx, x + 6, y - 1, 8, 2, 1.5, '#222');
  } else {
    const n = rank === 2 ? 5 : 3;
    for (let i = 0; i < n; i++) {
      const dx = (i - (n - 1) / 2) * 4.5;
      ctx.fillStyle = teamColor;
      ctx.beginPath();
      ctx.arc(x + dx, y, 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(x + dx - 1, y + 2, 2, 4);
    }
    if (rank === 3) {
      isoBox(ctx, x, y + 6, 10, 5, 3, '#868e96');
      isoBox(ctx, x + 2, y + 3, 4, 2, 2.5, teamColor);
    }
  }
  drawBadge(ctx, x, y - 2, rank);
  ctx.restore();
}

function offsetsForCount(count: number): { dx: number; dy: number }[] {
  if (count === 1) return [{ dx: 0, dy: 0 }];
  if (count === 3) {
    return [
      { dx: -9, dy: 3.5 },
      { dx: 0, dy: -2.5 },
      { dx: 9, dy: 3.5 },
    ];
  }
  if (count === 5) {
    return [
      { dx: -12, dy: 4.5 },
      { dx: -6, dy: -1.5 },
      { dx: 0, dy: 5.5 },
      { dx: 6, dy: -1.5 },
      { dx: 12, dy: 4.5 },
    ];
  }
  // 10 soldiers — two ranks of five (spacing for full militia-sized figures)
  const out: { dx: number; dy: number }[] = [];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 5; col++) {
      out.push({
        dx: -16 + col * 8 + (row === 1 ? 2 : 0),
        dy: -5 + row * 9,
      });
    }
  }
  return out;
}

function drawGroup(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  count: number,
  teamColor: string,
  drawOne: (ctx: CanvasRenderingContext2D, x: number, y: number, teamColor: string) => void,
  scale = 1,
): void {
  const offs = offsetsForCount(count).sort((a, b) => a.dy - b.dy);
  for (const o of offs) {
    if (scale !== 1) {
      ctx.save();
      ctx.translate(x + o.dx, y + o.dy);
      ctx.scale(scale, scale);
      drawOne(ctx, 0, 0, teamColor);
      ctx.restore();
    } else {
      drawOne(ctx, x + o.dx, y + o.dy, teamColor);
    }
  }
}

function drawSoldierSquad(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  teamColor: string,
  compact: boolean,
): void {
  // Same figure scale as militia (drawGroup 0.85)
  const scale = compact ? 0.72 : 0.85;
  drawGroup(ctx, x, y, 10, teamColor, compact ? drawSoldierSimple : drawSoldier, scale);
}

function drawSoldierSimple(ctx: CanvasRenderingContext2D, x: number, y: number, teamColor: string): void {
  shadow(ctx, x, y + 7, 4, 1.6, 0.25);
  isoBox(ctx, x - 1.4, y + 5, 2.2, 2, 3, '#111');
  isoBox(ctx, x + 1.4, y + 5, 2.2, 2, 3, '#111');
  isoBox(ctx, x, y + 0.5, 6, 4, 7, teamColor);
  isoCylinder(ctx, x, y - 6.5, 2.6, 1.5, 3, '#2f3e2f');
  isoBox(ctx, x + 4, y - 0.5, 6, 1.4, 1.3, '#222');
}

function drawSpecOpsSquad(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  teamColor: string,
): void {
  drawGunTruck(ctx, x + 2, y + 2, teamColor);
  const offs = [
    { dx: -11, dy: -1 },
    { dx: -3, dy: -4 },
    { dx: 6, dy: -2 },
  ];
  for (const o of offs.sort((a, b) => a.dy - b.dy)) {
    drawSpecOps(ctx, x + o.dx, y + o.dy, teamColor);
  }
}

/** Technical / pickup with mounted machine gun. */
function drawGunTruck(ctx: CanvasRenderingContext2D, x: number, y: number, teamColor: string): void {
  shadow(ctx, x, y + 8, 14, 4, 0.32);
  for (const wx of [-7, -2, 5, 10]) {
    isoCylinder(ctx, x + wx, y + 6.5, 2.2, 1.3, 2.8, '#495057');
    ctx.fillStyle = '#adb5bd';
    ctx.beginPath();
    ctx.arc(x + wx, y + 4.2, 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
  isoBox(ctx, x + 1, y + 4, 20, 9, 3.5, '#868e96');
  isoBox(ctx, x - 5, y + 1, 8, 8, 6, shade(teamColor, -25));
  isoBox(ctx, x - 5, y - 3.5, 7, 6, 2.5, '#74c0fc');
  ctx.fillStyle = 'rgba(116,192,252,0.35)';
  ctx.fillRect(x - 6.5, y - 5, 3, 1.5);
  isoBox(ctx, x + 6, y + 2.5, 12, 8, 3.2, shade(teamColor, -40));
  for (const dx of [2, 5, 8]) {
    isoBox(ctx, x + dx, y + 1, 2.8, 2.2, 1.8, '#c2a878');
  }
  isoCylinder(ctx, x + 6, y - 0.5, 2.4, 1.4, 2.2, '#6c757d');
  isoBox(ctx, x + 6, y - 2, 2, 2, 3, '#495057');
  isoBox(ctx, x + 10, y - 3.5, 9, 1.6, 1.5, '#6c757d');
  isoBox(ctx, x + 14, y - 4.5, 1.4, 1.4, 2, '#495057');
  isoBox(ctx, x + 4, y - 1, 2.5, 2, 2, '#3d2914');
  ctx.fillStyle = '#fff3bf';
  ctx.beginPath();
  ctx.arc(x - 8.5, y + 0.5, 1.1, 0, Math.PI * 2);
  ctx.fill();
}

/** Rank 1 — detailed militia with rifle. */
function drawMilitia(ctx: CanvasRenderingContext2D, x: number, y: number, teamColor: string): void {
  shadow(ctx, x, y + 8.5, 5, 2, 0.32);

  // Boots
  isoBox(ctx, x - 1.6, y + 7.2, 2.6, 2.8, 2.2, '#1a1a1a');
  isoBox(ctx, x + 1.6, y + 7.2, 2.6, 2.8, 2.2, '#1a1a1a');
  // Legs / pants
  isoBox(ctx, x - 1.5, y + 4.2, 2.4, 2.5, 4.2, '#4a5d4e');
  isoBox(ctx, x + 1.5, y + 4.2, 2.4, 2.5, 4.2, '#4a5d4e');
  // Belt
  isoBox(ctx, x, y + 1.6, 6.2, 4.2, 1.3, '#3d2914');
  ctx.fillStyle = '#c9a227';
  ctx.fillRect(x - 0.7, y + 0.6, 1.4, 1.2);
  // Torso jacket
  isoBox(ctx, x, y + 0.2, 6.4, 4.6, 7.2, teamColor);
  // Collar
  isoBox(ctx, x, y - 6.5, 5.2, 3.5, 1.2, shade(teamColor, -25));
  // Bandolier
  drawLine(ctx, x - 2.6, y - 5.5, x + 2.8, y + 1.5, '#2b2118', 1.35);
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    isoBox(ctx, x - 2.2 + t * 4.6, y - 5 + t * 6.2, 1.3, 1.1, 1.5, '#5c4033');
  }
  // Backpack
  isoBox(ctx, x - 0.3, y - 1.5, 4.2, 2.2, 4.5, '#5c4033');
  isoBox(ctx, x - 0.3, y - 5.5, 3.6, 1.8, 1.2, '#3d2914');
  // Arms
  isoBox(ctx, x - 3.6, y - 1, 2.2, 2.2, 4.5, teamColor);
  isoBox(ctx, x + 3.4, y - 0.5, 2.2, 2.2, 3.8, teamColor);
  // Hands
  isoCylinder(ctx, x - 3.6, y + 3.2, 1.1, 0.7, 1.4, '#e8c39e');
  isoCylinder(ctx, x + 4.2, y + 2.8, 1.1, 0.7, 1.4, '#e8c39e');
  // Head
  isoCylinder(ctx, x, y - 7.2, 2.55, 1.55, 3.6, '#f0c9a0');
  // Ears
  isoCylinder(ctx, x - 2.5, y - 8.5, 0.55, 0.4, 1.1, '#e8b892');
  isoCylinder(ctx, x + 2.5, y - 8.5, 0.55, 0.4, 1.1, '#e8b892');
  // Eyes
  ctx.fillStyle = '#2b2b2b';
  ctx.beginPath();
  ctx.ellipse(x - 0.85, y - 9.2, 0.45, 0.35, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 0.85, y - 9.2, 0.45, 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
  // Cap
  isoBox(ctx, x, y - 10.6, 5.8, 4.2, 1.8, '#3d5a40');
  isoBox(ctx, x + 1.8, y - 9.6, 3.2, 2.2, 0.7, '#2f4a34');
  // Cap badge
  ctx.fillStyle = '#ffd43b';
  ctx.beginPath();
  ctx.arc(x, y - 11.5, 0.9, 0, Math.PI * 2);
  ctx.fill();

  // Detailed bolt-action rifle
  drawRifle(ctx, x + 3.2, y - 1.2, teamColor);
}

function drawRifle(ctx: CanvasRenderingContext2D, x: number, y: number, _team: string): void {
  // Stock
  isoBox(ctx, x - 1.5, y + 1.5, 3.5, 1.6, 1.8, '#6b4226');
  // Receiver
  isoBox(ctx, x + 2.5, y + 0.6, 5, 1.5, 1.6, '#2b2b2b');
  // Barrel
  isoBox(ctx, x + 8.5, y - 0.2, 9, 1.1, 1.05, '#1a1a1a');
  // Front sight
  isoBox(ctx, x + 12.2, y - 1.4, 0.9, 0.9, 1.6, '#111');
  // Rear sight
  isoBox(ctx, x + 3.5, y - 1.1, 1.4, 1.1, 1.3, '#333');
  // Bolt handle
  isoBox(ctx, x + 2.2, y - 0.8, 1.2, 2.4, 0.7, '#444');
  // Trigger guard
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.arc(x + 1.2, y + 2.2, 1.3, 0.15, Math.PI - 0.15);
  ctx.stroke();
  // Sling
  drawLine(ctx, x - 2, y + 0.5, x + 7, y - 0.8, '#3d2914', 0.7);
}

/** Rank 2 — detailed modern soldier. */
function drawSoldier(ctx: CanvasRenderingContext2D, x: number, y: number, teamColor: string): void {
  shadow(ctx, x, y + 9, 5.8, 2.2, 0.34);

  // Combat boots
  isoBox(ctx, x - 1.8, y + 7.6, 3, 3.2, 2.6, '#111');
  isoBox(ctx, x + 1.8, y + 7.6, 3, 3.2, 2.6, '#111');
  ctx.fillStyle = '#333';
  ctx.fillRect(x - 2.6, y + 7.8, 1.6, 0.6);
  ctx.fillRect(x + 1, y + 7.8, 1.6, 0.6);
  // Pants + kneepads
  isoBox(ctx, x - 1.7, y + 4.5, 2.8, 2.8, 4.5, shade(teamColor, -35));
  isoBox(ctx, x + 1.7, y + 4.5, 2.8, 2.8, 4.5, shade(teamColor, -35));
  isoBox(ctx, x - 1.7, y + 5.5, 3, 2.2, 1.6, '#2b2b2b');
  isoBox(ctx, x + 1.7, y + 5.5, 3, 2.2, 1.6, '#2b2b2b');
  // Torso
  isoBox(ctx, x, y + 0.5, 7.4, 5.2, 8, teamColor);
  // Plate carrier
  isoBox(ctx, x, y - 0.5, 7.8, 5.4, 6.2, shade(teamColor, -40));
  // Mag pouches (3)
  for (const dx of [-2.4, 0, 2.4]) {
    isoBox(ctx, x + dx, y + 1.2, 2.1, 1.8, 2.6, '#1a1a1a');
    ctx.fillStyle = '#444';
    ctx.fillRect(x + dx - 0.5, y + 0.2, 1, 0.5);
  }
  // Radio
  isoBox(ctx, x - 3.6, y - 3.5, 1.8, 1.6, 3.2, '#222');
  isoBox(ctx, x - 3.6, y - 6.5, 0.7, 0.7, 2.2, '#111');
  // Arms
  isoBox(ctx, x - 4.2, y - 1.2, 2.5, 2.4, 5, teamColor);
  isoBox(ctx, x + 4.2, y - 0.8, 2.5, 2.4, 4.5, teamColor);
  // Gloves
  isoBox(ctx, x - 4.2, y + 3.5, 2.3, 2.2, 1.8, '#1c1c1c');
  isoBox(ctx, x + 4.8, y + 3.2, 2.3, 2.2, 1.8, '#1c1c1c');
  // Neck / face
  isoCylinder(ctx, x, y - 7.5, 2.3, 1.4, 2.2, '#e8c39e');
  // Helmet
  isoCylinder(ctx, x, y - 9.2, 3.5, 2.1, 3.8, '#2f3e2f');
  isoBox(ctx, x, y - 9.5, 7.2, 4.5, 1.2, '#263326');
  // Helmet mount / NV rail
  isoBox(ctx, x, y - 12.8, 2.4, 2, 1.1, '#111');
  // Goggles on helmet
  isoBox(ctx, x, y - 10.2, 4.5, 2.2, 1.3, '#333');
  ctx.fillStyle = 'rgba(100,180,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(x, y - 10.5, 1.8, 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  // Chin strap
  drawLine(ctx, x - 2.2, y - 8.2, x + 2.2, y - 8.2, '#1a1a1a', 0.8);

  drawAssaultRifle(ctx, x + 4.5, y - 0.5);
}

function drawAssaultRifle(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  // Stock
  isoBox(ctx, x - 2.5, y + 1.2, 3.2, 1.5, 1.7, '#1a1a1a');
  // Body
  isoBox(ctx, x + 2, y + 0.4, 6.5, 1.7, 2, '#2b2b2b');
  // Mag
  isoBox(ctx, x + 1.5, y + 3.2, 1.8, 1.4, 3.2, '#111');
  // Handguard
  isoBox(ctx, x + 6.5, y + 0.2, 4.5, 1.6, 1.7, '#333');
  // Barrel + flash hider
  isoBox(ctx, x + 11, y - 0.3, 5.5, 1, 1, '#1a1a1a');
  isoBox(ctx, x + 13.5, y - 0.6, 1.6, 1.3, 1.4, '#111');
  // Optic
  isoBox(ctx, x + 3.2, y - 1.8, 3.2, 1.5, 1.8, '#222');
  ctx.fillStyle = '#1864ab';
  ctx.beginPath();
  ctx.arc(x + 3.2, y - 2.6, 0.7, 0, Math.PI * 2);
  ctx.fill();
  // Grip
  isoBox(ctx, x + 0.2, y + 2.5, 1.5, 1.4, 2.4, '#1a1a1a');
}

/** Rank 3 — detailed special forces (gray kit). */
function drawSpecOps(ctx: CanvasRenderingContext2D, x: number, y: number, teamColor: string): void {
  shadow(ctx, x, y + 9, 5.6, 2.2, 0.36);

  // Boots
  isoBox(ctx, x - 1.7, y + 7.5, 2.9, 3, 2.5, '#495057');
  isoBox(ctx, x + 1.7, y + 7.5, 2.9, 3, 2.5, '#495057');
  // Legs
  isoBox(ctx, x - 1.6, y + 4.4, 2.7, 2.7, 4.4, '#6c757d');
  isoBox(ctx, x + 1.6, y + 4.4, 2.7, 2.7, 4.4, '#6c757d');
  // Holster
  isoBox(ctx, x + 2.8, y + 4.8, 1.6, 1.5, 2.8, '#495057');
  // Torso armor
  isoBox(ctx, x, y + 0.4, 7.5, 5.3, 8.2, '#868e96');
  // Team ID stripe
  isoBox(ctx, x, y + 2.2, 7.7, 5.4, 2.1, teamColor);
  // Pouches row
  for (const dx of [-2.6, -0.9, 0.9, 2.6]) {
    isoBox(ctx, x + dx, y + 0.8, 1.5, 1.5, 2.3, '#495057');
  }
  // Shoulder pads
  isoBox(ctx, x - 4.3, y - 3.5, 2.6, 2.4, 2.2, '#adb5bd');
  isoBox(ctx, x + 4.3, y - 3.5, 2.6, 2.4, 2.2, '#adb5bd');
  // Arms
  isoBox(ctx, x - 4.3, y - 0.8, 2.4, 2.3, 4.8, '#868e96');
  isoBox(ctx, x + 4.3, y - 0.5, 2.4, 2.3, 4.4, '#868e96');
  // Gloves
  isoBox(ctx, x - 4.3, y + 3.6, 2.3, 2.2, 1.7, '#495057');
  isoBox(ctx, x + 5, y + 3.4, 2.3, 2.2, 1.7, '#495057');
  // Balaclava head
  isoCylinder(ctx, x, y - 7.4, 2.9, 1.7, 3.8, '#6c757d');
  // NVG dual tubes
  isoBox(ctx, x - 1.3, y - 10.2, 2.2, 2.2, 2.6, '#495057');
  isoBox(ctx, x + 1.3, y - 10.2, 2.2, 2.2, 2.6, '#495057');
  const visor = ctx.createLinearGradient(x - 2.5, y - 9, x + 2.5, y - 7.5);
  visor.addColorStop(0, '#74c0fc');
  visor.addColorStop(0.5, '#1c7ed6');
  visor.addColorStop(1, '#1864ab');
  ctx.fillStyle = visor;
  ctx.beginPath();
  ctx.ellipse(x, y - 8.6, 2.5, 0.85, 0, 0, Math.PI * 2);
  ctx.fill();
  // Glow
  ctx.fillStyle = 'rgba(116,192,252,0.25)';
  ctx.beginPath();
  ctx.ellipse(x, y - 8.6, 3.2, 1.3, 0, 0, Math.PI * 2);
  ctx.fill();
  // Headset
  isoBox(ctx, x - 3.1, y - 8.8, 1.3, 1.5, 2.2, '#495057');
  drawLine(ctx, x - 3.1, y - 7.5, x - 1.5, y - 6.2, '#6c757d', 1);

  drawSuppressedSMG(ctx, x + 4.2, y - 0.2);
}

function drawSuppressedSMG(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  isoBox(ctx, x - 1.5, y + 1, 2.8, 1.4, 1.5, '#495057');
  isoBox(ctx, x + 2.2, y + 0.3, 5.5, 1.6, 1.9, '#6c757d');
  isoBox(ctx, x + 1.5, y + 2.8, 1.5, 1.3, 2.6, '#495057');
  isoBox(ctx, x + 6.5, y + 0.1, 3.5, 1.3, 1.4, '#adb5bd');
  // Suppressor
  isoCylinder(ctx, x + 10.5, y - 0.3, 1.1, 0.7, 4.5, '#6c757d');
  isoBox(ctx, x + 3, y - 1.6, 2.4, 1.3, 1.4, '#495057');
  // Laser
  ctx.fillStyle = '#fa5252';
  ctx.beginPath();
  ctx.arc(x + 5.5, y + 1.5, 0.55, 0, Math.PI * 2);
  ctx.fill();
}

const T90_SRC = '/t90-tank.png';
let t90Image: HTMLImageElement | null = null;
let t90LoadFailed = false;
const t90ReadyListeners: Array<() => void> = [];

function notifyT90Ready(): void {
  const listeners = t90ReadyListeners.splice(0);
  for (const fn of listeners) fn();
}

function getT90Image(): HTMLImageElement | null {
  if (t90LoadFailed) return null;
  if (typeof Image === 'undefined') return null;
  if (!t90Image) {
    t90Image = new Image();
    t90Image.decoding = 'async';
    t90Image.onload = () => notifyT90Ready();
    t90Image.onerror = () => {
      t90LoadFailed = true;
    };
    t90Image.src = T90_SRC;
  }
  if (t90Image.complete && t90Image.naturalWidth > 0) return t90Image;
  return null;
}

/** Start loading unit photo sprites; `onReady` fires when T-90 is available. */
export function preloadUnitSprites(onReady?: () => void): void {
  if (onReady) {
    if (getT90Image()) onReady();
    else t90ReadyListeners.push(onReady);
  } else {
    getT90Image();
  }
}

/** Rank 4 — T-90 main battle tank (photo sprite). */
function drawTank(ctx: CanvasRenderingContext2D, x: number, y: number, teamColor: string): void {
  shadow(ctx, x, y + 10, 16, 5, 0.38);
  const img = getT90Image();
  if (img) {
    const size = 44;
    ctx.drawImage(img, x - size / 2, y - size / 2 - 3, size, size);
    // Team marking stripe on hull
    isoBox(ctx, x - 5, y + 7, 10, 3.2, 1.6, teamColor);
  } else {
    // Fallback silhouette until image loads
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
  ctx.imageSmoothingQuality = 'high';
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
  ctx.restore();
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
