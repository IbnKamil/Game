import { BUILDING_PROTECTION, UNIT_FIGURE_COUNT, houseRankFromKind, isHouseBuilding } from './constants';
import type { BuildingKind, UnitRank } from './types';

/** Isometric 3D-style canvas figurines. */

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

function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(x, y + 1, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Isometric box: top + left + right faces. */
function isoBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  d: number,
  h: number,
  color: string,
): void {
  const hw = w / 2;
  const hd = d / 2;
  const top = shade(color, 38);
  const left = shade(color, -28);
  const right = shade(color, -8);

  // top
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.moveTo(x, y - h);
  ctx.lineTo(x + hw, y - h + hd * 0.55);
  ctx.lineTo(x, y - h + hd * 1.1);
  ctx.lineTo(x - hw, y - h + hd * 0.55);
  ctx.closePath();
  ctx.fill();

  // left
  ctx.fillStyle = left;
  ctx.beginPath();
  ctx.moveTo(x - hw, y - h + hd * 0.55);
  ctx.lineTo(x, y - h + hd * 1.1);
  ctx.lineTo(x, y + hd * 1.1);
  ctx.lineTo(x - hw, y + hd * 0.55);
  ctx.closePath();
  ctx.fill();

  // right
  ctx.fillStyle = right;
  ctx.beginPath();
  ctx.moveTo(x + hw, y - h + hd * 0.55);
  ctx.lineTo(x, y - h + hd * 1.1);
  ctx.lineTo(x, y + hd * 1.1);
  ctx.lineTo(x + hw, y + hd * 0.55);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(x, y - h);
  ctx.lineTo(x + hw, y - h + hd * 0.55);
  ctx.lineTo(x, y - h + hd * 1.1);
  ctx.lineTo(x - hw, y - h + hd * 0.55);
  ctx.closePath();
  ctx.stroke();
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
  const top = shade(color, 35);
  const side = shade(color, -18);
  ctx.fillStyle = side;
  ctx.beginPath();
  ctx.moveTo(x - rx, y);
  ctx.lineTo(x - rx, y - h);
  ctx.ellipse(x, y - h, rx, ry, 0, Math.PI, 0, true);
  ctx.lineTo(x + rx, y);
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI, false);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.ellipse(x, y - h, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.lineWidth = 0.6;
  ctx.stroke();
}

export function drawUnitFigurine(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rank: UnitRank,
  moved: boolean,
  teamColor: string,
): void {
  ctx.save();
  ctx.globalAlpha = moved ? 0.55 : 1;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (rank === 1) drawMilitiaGroup(ctx, x, y, UNIT_FIGURE_COUNT[1], teamColor);
  else if (rank === 2) drawSoldierGroup(ctx, x, y, UNIT_FIGURE_COUNT[2], teamColor);
  else if (rank === 3) drawSpecOpsGroup(ctx, x, y, UNIT_FIGURE_COUNT[3], teamColor);
  else drawTank(ctx, x, y, teamColor);

  // Rank badge (glossy)
  const bx = x + 12;
  const by = y - 14;
  shadow(ctx, bx, by + 6, 5, 2);
  const grad = ctx.createRadialGradient(bx - 1, by - 2, 1, bx, by, 7);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(0.35, '#ffd43b');
  grad.addColorStop(1, '#e67700');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(bx, by, 6.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#212529';
  ctx.font = 'bold 9px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(rank), bx, by + 0.5);

  ctx.restore();
}

function offsetsForCount(count: number): { dx: number; dy: number }[] {
  if (count === 1) return [{ dx: 0, dy: 0 }];
  if (count === 3) {
    return [
      { dx: -8, dy: 3 },
      { dx: 0, dy: -2 },
      { dx: 8, dy: 3 },
    ];
  }
  return [
    { dx: -11, dy: 4 },
    { dx: -5.5, dy: -1 },
    { dx: 0, dy: 5 },
    { dx: 5.5, dy: -1 },
    { dx: 11, dy: 4 },
  ];
}

function drawMilitiaGroup(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  count: number,
  teamColor: string,
): void {
  const offs = offsetsForCount(count).sort((a, b) => a.dy - b.dy);
  for (const o of offs) drawMilitia(ctx, x + o.dx, y + o.dy, teamColor);
}

function drawMilitia(ctx: CanvasRenderingContext2D, x: number, y: number, teamColor: string): void {
  shadow(ctx, x, y + 7, 4.5, 1.8);
  // Legs
  isoBox(ctx, x - 1.4, y + 5, 2.2, 2.2, 3.5, '#2b2b2b');
  isoBox(ctx, x + 1.4, y + 5, 2.2, 2.2, 3.5, '#2b2b2b');
  // Body
  isoBox(ctx, x, y + 1, 5.5, 4, 6, teamColor);
  // Head
  isoCylinder(ctx, x, y - 5, 2.3, 1.4, 3.2, '#f5d0a9');
  // Cap
  isoBox(ctx, x, y - 8.2, 5, 3.5, 1.6, '#3d5a40');
  // Rifle (3D bar)
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.moveTo(x + 2.5, y - 1);
  ctx.lineTo(x + 9, y - 4);
  ctx.lineTo(x + 9.5, y - 3.2);
  ctx.lineTo(x + 3, y - 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#444';
  ctx.fillRect(x + 7.5, y - 4.5, 1.4, 2.2);
}

function drawSoldierGroup(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  count: number,
  teamColor: string,
): void {
  const offs = offsetsForCount(count).sort((a, b) => a.dy - b.dy);
  for (const o of offs) drawSoldier(ctx, x + o.dx, y + o.dy, teamColor);
}

function drawSoldier(ctx: CanvasRenderingContext2D, x: number, y: number, teamColor: string): void {
  shadow(ctx, x, y + 8, 5.5, 2);
  isoBox(ctx, x - 1.6, y + 6, 2.6, 2.4, 3.8, '#111');
  isoBox(ctx, x + 1.6, y + 6, 2.6, 2.4, 3.8, '#111');
  isoBox(ctx, x, y + 1.5, 7, 5, 7.5, teamColor);
  // Vest straps
  ctx.strokeStyle = shade(teamColor, -45);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x - 2, y - 4);
  ctx.lineTo(x - 1, y + 3);
  ctx.moveTo(x + 2, y - 4);
  ctx.lineTo(x + 1, y + 3);
  ctx.stroke();
  // Helmet
  isoCylinder(ctx, x, y - 6.5, 3.2, 1.8, 3.5, '#2f3e2f');
  ctx.fillStyle = '#e8c39e';
  ctx.beginPath();
  ctx.ellipse(x, y - 5.2, 2, 1.1, 0, 0, Math.PI);
  ctx.fill();
  // Rifle
  isoBox(ctx, x + 5, y - 1, 8, 2, 1.6, '#222');
  isoBox(ctx, x + 8.5, y - 2.5, 1.6, 1.6, 2.8, '#111');
}

function drawSpecOpsGroup(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  count: number,
  teamColor: string,
): void {
  const offs = offsetsForCount(count).sort((a, b) => a.dy - b.dy);
  for (const o of offs) drawSpecOps(ctx, x + o.dx, y + o.dy, teamColor);
}

function drawSpecOps(ctx: CanvasRenderingContext2D, x: number, y: number, teamColor: string): void {
  shadow(ctx, x, y + 8, 5.2, 2);
  isoBox(ctx, x - 1.5, y + 6, 2.5, 2.3, 3.6, '#0a0a0a');
  isoBox(ctx, x + 1.5, y + 6, 2.5, 2.3, 3.6, '#0a0a0a');
  isoBox(ctx, x, y + 1.5, 7, 5, 7.5, '#1c1f24');
  // Team stripe
  isoBox(ctx, x, y + 2.5, 7.2, 5.2, 2.2, teamColor);
  // Head / balaclava
  isoCylinder(ctx, x, y - 6.2, 2.8, 1.6, 3.4, '#111');
  // Visor glow
  const g = ctx.createLinearGradient(x - 2.5, y - 6.5, x + 2.5, y - 5);
  g.addColorStop(0, '#74c0fc');
  g.addColorStop(1, '#1864ab');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y - 5.8, 2.3, 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
  // SMG
  isoBox(ctx, x + 4.5, y - 0.5, 6.5, 2, 1.5, '#333');
  isoBox(ctx, x + 7, y - 2, 1.5, 1.5, 2.4, '#111');
}

function drawTank(ctx: CanvasRenderingContext2D, x: number, y: number, teamColor: string): void {
  shadow(ctx, x, y + 7, 14, 4.5);
  // Tracks
  isoBox(ctx, x - 7, y + 5, 6, 8, 3.5, '#1a1a1a');
  isoBox(ctx, x + 7, y + 5, 6, 8, 3.5, '#1a1a1a');
  // Hull
  isoBox(ctx, x, y + 2, 18, 12, 7, teamColor);
  // Turret
  isoBox(ctx, x - 1, y - 4, 10, 8, 5.5, shade(teamColor, -20));
  // Cannon
  isoBox(ctx, x + 10, y - 5.5, 14, 2.4, 2, '#222');
  // Hatch
  isoCylinder(ctx, x - 2, y - 9.5, 2.2, 1.2, 1.5, '#111');
  // Detail lights
  ctx.fillStyle = '#ffd43b';
  ctx.beginPath();
  ctx.arc(x - 7, y - 1, 1.2, 0, Math.PI * 2);
  ctx.fill();
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
    drawHouse(ctx, x, y, houseRankFromKind(kind)!, trainLeft);
  }
  ctx.restore();
}

function drawCapital(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  shadow(ctx, x, y + 8, 13, 4);
  isoBox(ctx, x, y + 4, 20, 14, 8, '#d8d0c4');
  isoBox(ctx, x - 6, y - 4, 7, 7, 10, '#ebe4d8');
  isoBox(ctx, x + 6, y - 4, 7, 7, 10, '#ebe4d8');
  isoBox(ctx, x, y - 8, 8, 8, 14, '#f1ece3');
  // Battlements
  for (const dx of [-8, -3, 3, 8]) {
    isoBox(ctx, x + dx, y - 2, 3.2, 3, 3, '#c2b8a8');
  }
  // Flag pole + flag
  ctx.strokeStyle = '#6b4226';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x, y - 22);
  ctx.lineTo(x, y - 30);
  ctx.stroke();
  ctx.fillStyle = '#c92a2a';
  ctx.beginPath();
  ctx.moveTo(x, y - 30);
  ctx.lineTo(x + 9, y - 27);
  ctx.lineTo(x, y - 24);
  ctx.closePath();
  ctx.fill();
  // Gate
  ctx.fillStyle = '#4a3728';
  ctx.beginPath();
  ctx.ellipse(x, y + 5, 3.2, 4, 0, Math.PI, 0);
  ctx.fill();
}

function drawFarm(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  shadow(ctx, x, y + 8, 12, 3.5);
  // Field
  ctx.fillStyle = '#74c069';
  ctx.beginPath();
  ctx.ellipse(x, y + 6, 12, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2b8a3e';
  ctx.lineWidth = 0.8;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.ellipse(x, y + 6, 11, 3.2, 0, 0.2 + i * 0.05, Math.PI - 0.2 + i * 0.05);
    ctx.stroke();
  }
  // Barn
  isoBox(ctx, x - 2, y + 1, 14, 10, 8, '#d9480f');
  // Roof prism
  ctx.fillStyle = '#f08c00';
  ctx.beginPath();
  ctx.moveTo(x - 9, y - 7);
  ctx.lineTo(x - 2, y - 14);
  ctx.lineTo(x + 5, y - 7);
  ctx.lineTo(x + 5, y - 5);
  ctx.lineTo(x - 2, y - 11);
  ctx.lineTo(x - 9, y - 5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e8590c';
  ctx.beginPath();
  ctx.moveTo(x + 5, y - 7);
  ctx.lineTo(x - 2, y - 14);
  ctx.lineTo(x + 5, y - 10);
  ctx.closePath();
  ctx.fill();
  // Silo
  isoCylinder(ctx, x + 9, y + 2, 3, 1.6, 12, '#adb5bd');
  // Door
  isoBox(ctx, x - 2, y + 2, 3.5, 2, 4.5, '#5c3d1e');
}

function drawTower(ctx: CanvasRenderingContext2D, x: number, y: number, strong: boolean): void {
  shadow(ctx, x, y + 8, 8, 3);
  const body = strong ? '#343a40' : '#868e96';
  isoBox(ctx, x, y + 4, 12, 10, 6, shade(body, -10));
  isoCylinder(ctx, x, y - 2, 5, 3, 14, body);
  isoBox(ctx, x, y - 16, 14, 10, 4, strong ? '#212529' : '#495057');
  if (strong) {
    isoCylinder(ctx, x, y - 20, 2, 1.2, 5, '#c92a2a');
    ctx.fillStyle = '#fa5252';
    ctx.beginPath();
    ctx.arc(x, y - 25, 2.4, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = '#fab005';
    ctx.beginPath();
    ctx.moveTo(x - 5, y - 18);
    ctx.lineTo(x, y - 24);
    ctx.lineTo(x + 5, y - 18);
    ctx.closePath();
    ctx.fill();
  }
  // Slits
  ctx.fillStyle = '#111';
  ctx.fillRect(x - 2.5, y - 10, 1.4, 3);
  ctx.fillRect(x + 1.1, y - 10, 1.4, 3);
  const prot = BUILDING_PROTECTION[strong ? 'strongTower' : 'tower'];
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 9px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 2;
  ctx.strokeText(String(prot), x, y + 1);
  ctx.fillText(String(prot), x, y + 1);
}

function drawHouse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rank: number,
  trainLeft: number | null,
): void {
  const colors = ['#94d82d', '#74c0fc', '#ff922b', '#e599f7'];
  const accent = colors[rank - 1];
  const w = 12 + rank * 2;
  const h = 7 + rank * 1.5;
  shadow(ctx, x, y + 7, w * 0.55, 3);
  isoBox(ctx, x, y + 3, w, w * 0.7, h, '#f1ece3');
  // Roof
  ctx.fillStyle = shade(accent, 20);
  ctx.beginPath();
  ctx.moveTo(x - w / 2 - 2, y + 3 - h + 2);
  ctx.lineTo(x, y + 3 - h - 6 - rank);
  ctx.lineTo(x + w / 2 + 2, y + 3 - h + 2);
  ctx.lineTo(x, y + 3 - h + 5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = shade(accent, -25);
  ctx.beginPath();
  ctx.moveTo(x + w / 2 + 2, y + 3 - h + 2);
  ctx.lineTo(x, y + 3 - h - 6 - rank);
  ctx.lineTo(x + w / 2 - 1, y + 3 - h + 6);
  ctx.closePath();
  ctx.fill();
  // Door + windows
  isoBox(ctx, x, y + 4, 3.2, 2.5, 4, '#5c4033');
  for (let i = 0; i < rank; i++) {
    const wx = x - w / 3 + i * (w / Math.max(rank, 1)) * 0.55;
    isoBox(ctx, wx, y - 1, 2.4, 2, 2.2, '#fff3bf');
  }
  isoBox(ctx, x + w / 3, y - h + 2, 2.5, 2.5, 4, shade(accent, -40));
  ctx.fillStyle = '#212529';
  ctx.font = 'bold 8px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`H${rank}`, x, y + 8);

  if (trainLeft !== null) {
    const bx = x + w / 2 + 2;
    const by = y - h - 4;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(bx, by, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c92a2a';
    ctx.font = 'bold 9px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(trainLeft), bx, by + 0.5);
  }
}
