import { BUILDING_PROTECTION, UNIT_FIGURE_COUNT, houseRankFromKind, isHouseBuilding } from './constants';
import type { BuildingKind, UnitRank } from './types';

/** Canvas figurines for units and buildings. */

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

  if (rank === 1) {
    drawMilitiaGroup(ctx, x, y, UNIT_FIGURE_COUNT[1], teamColor);
  } else if (rank === 2) {
    drawSoldierGroup(ctx, x, y, UNIT_FIGURE_COUNT[2], teamColor);
  } else if (rank === 3) {
    drawSpecOpsGroup(ctx, x, y, UNIT_FIGURE_COUNT[3], teamColor);
  } else {
    drawTank(ctx, x, y, teamColor);
  }

  // Rank badge
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.arc(x + 11, y - 12, 6.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 9px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(rank), x + 11, y - 11.5);

  ctx.restore();
}

function offsetsForCount(count: number): { dx: number; dy: number }[] {
  if (count === 1) return [{ dx: 0, dy: 0 }];
  if (count === 3) {
    return [
      { dx: -7, dy: 2 },
      { dx: 0, dy: -3 },
      { dx: 7, dy: 2 },
    ];
  }
  // 5 militia
  return [
    { dx: -10, dy: 3 },
    { dx: -5, dy: -2 },
    { dx: 0, dy: 4 },
    { dx: 5, dy: -2 },
    { dx: 10, dy: 3 },
  ];
}

function drawMilitiaGroup(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  count: number,
  teamColor: string,
): void {
  for (const o of offsetsForCount(count)) {
    drawMilitia(ctx, x + o.dx, y + o.dy, teamColor);
  }
}

function drawMilitia(ctx: CanvasRenderingContext2D, x: number, y: number, teamColor: string): void {
  // Body
  ctx.fillStyle = teamColor;
  ctx.fillRect(x - 2, y - 1, 4, 6);
  // Head
  ctx.fillStyle = '#f5d0a9';
  ctx.beginPath();
  ctx.arc(x, y - 3.5, 2.2, 0, Math.PI * 2);
  ctx.fill();
  // Cap
  ctx.fillStyle = '#3d5a40';
  ctx.fillRect(x - 2.4, y - 5.5, 4.8, 1.6);
  // Rifle
  ctx.strokeStyle = '#2b2b2b';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(x + 2, y);
  ctx.lineTo(x + 7, y - 3);
  ctx.stroke();
  // Legs
  ctx.strokeStyle = '#1f2a24';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 1.2, y + 5);
  ctx.lineTo(x - 2.2, y + 8);
  ctx.moveTo(x + 1.2, y + 5);
  ctx.lineTo(x + 2.2, y + 8);
  ctx.stroke();
}

function drawSoldierGroup(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  count: number,
  teamColor: string,
): void {
  for (const o of offsetsForCount(count)) {
    drawSoldier(ctx, x + o.dx, y + o.dy, teamColor);
  }
}

function drawSoldier(ctx: CanvasRenderingContext2D, x: number, y: number, teamColor: string): void {
  // Torso vest
  ctx.fillStyle = teamColor;
  ctx.fillRect(x - 3, y - 2, 6, 7);
  // Helmet
  ctx.fillStyle = '#2f3e2f';
  ctx.beginPath();
  ctx.ellipse(x, y - 5, 3.2, 2.4, 0, 0, Math.PI * 2);
  ctx.fill();
  // Face
  ctx.fillStyle = '#e8c39e';
  ctx.fillRect(x - 1.5, y - 4.2, 3, 2);
  // Assault rifle
  ctx.fillStyle = '#222';
  ctx.fillRect(x + 3, y - 1, 7, 1.4);
  ctx.fillRect(x + 8, y - 2.5, 1.2, 2.5);
  // Boots
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(x - 3, y + 5, 2.5, 2.5);
  ctx.fillRect(x + 0.5, y + 5, 2.5, 2.5);
}

function drawSpecOpsGroup(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  count: number,
  teamColor: string,
): void {
  for (const o of offsetsForCount(count)) {
    drawSpecOps(ctx, x + o.dx, y + o.dy, teamColor);
  }
}

function drawSpecOps(ctx: CanvasRenderingContext2D, x: number, y: number, teamColor: string): void {
  // Dark armor with team accent
  ctx.fillStyle = '#1c1f24';
  ctx.fillRect(x - 3.2, y - 2, 6.4, 7);
  ctx.fillStyle = teamColor;
  ctx.fillRect(x - 3.2, y + 1, 6.4, 2);
  // Balaclava head
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(x, y - 4.5, 2.6, 0, Math.PI * 2);
  ctx.fill();
  // Visor
  ctx.fillStyle = '#4dabf7';
  ctx.fillRect(x - 2, y - 5, 4, 1.3);
  // Compact SMG
  ctx.fillStyle = '#444';
  ctx.fillRect(x + 3, y - 0.5, 5.5, 1.6);
  ctx.fillStyle = '#222';
  ctx.fillRect(x + 6.5, y - 2, 1.2, 2.2);
  // Legs
  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(x - 2.8, y + 5, 2.2, 2.8);
  ctx.fillRect(x + 0.6, y + 5, 2.2, 2.8);
}

function drawTank(ctx: CanvasRenderingContext2D, x: number, y: number, teamColor: string): void {
  // Tracks
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(x - 12, y + 2, 24, 6);
  ctx.fillStyle = '#333';
  for (let i = 0; i < 5; i++) {
    ctx.fillRect(x - 10 + i * 4.5, y + 3.2, 2.5, 3.5);
  }
  // Hull
  ctx.fillStyle = teamColor;
  ctx.beginPath();
  ctx.moveTo(x - 10, y + 2);
  ctx.lineTo(x - 8, y - 4);
  ctx.lineTo(x + 8, y - 4);
  ctx.lineTo(x + 10, y + 2);
  ctx.closePath();
  ctx.fill();
  // Turret
  ctx.fillStyle = shade(teamColor, -25);
  ctx.fillRect(x - 5, y - 9, 10, 7);
  // Cannon
  ctx.fillStyle = '#222';
  ctx.fillRect(x + 4, y - 7, 12, 2.2);
  // Hatch
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(x - 1, y - 7, 1.6, 0, Math.PI * 2);
  ctx.fill();
}

function shade(hex: string, amt: number): string {
  const n = hex.replace('#', '');
  const num = parseInt(n.length === 3 ? n.split('').map((c) => c + c).join('') : n, 16);
  const r = Math.min(255, Math.max(0, ((num >> 16) & 255) + amt));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 255) + amt));
  const b = Math.min(255, Math.max(0, (num & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

export function drawBuildingFigurine(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  kind: BuildingKind,
  trainLeft: number | null,
): void {
  ctx.save();
  if (kind === 'castle') {
    drawCapital(ctx, x, y);
  } else if (kind === 'farm') {
    drawFarm(ctx, x, y);
  } else if (kind === 'tower') {
    drawTower(ctx, x, y, false);
  } else if (kind === 'strongTower') {
    drawTower(ctx, x, y, true);
  } else if (isHouseBuilding(kind)) {
    const rank = houseRankFromKind(kind)!;
    drawHouse(ctx, x, y, rank, trainLeft);
  }
  ctx.restore();
}

function drawCapital(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  // Plaza
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath();
  ctx.arc(x, y + 4, 11, 0, Math.PI * 2);
  ctx.fill();
  // Keep walls
  ctx.fillStyle = '#d8d0c4';
  ctx.fillRect(x - 10, y - 4, 20, 12);
  // Battlements
  ctx.fillStyle = '#c2b8a8';
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(x - 10 + i * 5.2, y - 8, 3.5, 4);
  }
  // Central tower
  ctx.fillStyle = '#ebe4d8';
  ctx.fillRect(x - 4, y - 14, 8, 10);
  // Flag
  ctx.strokeStyle = '#6b4226';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x, y - 14);
  ctx.lineTo(x, y - 22);
  ctx.stroke();
  ctx.fillStyle = '#c92a2a';
  ctx.beginPath();
  ctx.moveTo(x, y - 22);
  ctx.lineTo(x + 8, y - 19);
  ctx.lineTo(x, y - 16);
  ctx.closePath();
  ctx.fill();
  // Gate
  ctx.fillStyle = '#4a3728';
  ctx.beginPath();
  ctx.arc(x, y + 4, 3.5, Math.PI, 0);
  ctx.fill();
}

function drawFarm(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  // Field rows
  ctx.strokeStyle = '#8ac926';
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(x - 10, y + 2 + i * 2.5);
    ctx.lineTo(x + 10, y + 2 + i * 2.5);
    ctx.stroke();
  }
  // Barn
  ctx.fillStyle = '#d9480f';
  ctx.fillRect(x - 7, y - 6, 14, 9);
  ctx.fillStyle = '#f08c00';
  ctx.beginPath();
  ctx.moveTo(x - 8, y - 6);
  ctx.lineTo(x, y - 13);
  ctx.lineTo(x + 8, y - 6);
  ctx.closePath();
  ctx.fill();
  // Door
  ctx.fillStyle = '#5c3d1e';
  ctx.fillRect(x - 2, y - 2, 4, 5);
  // Silo
  ctx.fillStyle = '#adb5bd';
  ctx.fillRect(x + 8, y - 8, 4, 11);
  ctx.beginPath();
  ctx.arc(x + 10, y - 8, 2, Math.PI, 0);
  ctx.fill();
}

function drawTower(ctx: CanvasRenderingContext2D, x: number, y: number, strong: boolean): void {
  const body = strong ? '#343a40' : '#868e96';
  const top = strong ? '#212529' : '#495057';
  // Base
  ctx.fillStyle = body;
  ctx.fillRect(x - 6, y - 2, 12, 10);
  // Shaft
  ctx.fillStyle = shade(body, 20);
  ctx.fillRect(x - 4.5, y - 12, 9, 10);
  // Turret head
  ctx.fillStyle = top;
  ctx.fillRect(x - 7, y - 16, 14, 5);
  // Slits
  ctx.fillStyle = '#111';
  ctx.fillRect(x - 3, y - 14.5, 1.5, 2.5);
  ctx.fillRect(x + 1.5, y - 14.5, 1.5, 2.5);
  // Antenna / gun for strong
  if (strong) {
    ctx.fillStyle = '#c92a2a';
    ctx.fillRect(x - 1, y - 22, 2, 6);
    ctx.beginPath();
    ctx.arc(x, y - 22, 2.2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = '#fab005';
    ctx.beginPath();
    ctx.moveTo(x - 5, y - 16);
    ctx.lineTo(x, y - 21);
    ctx.lineTo(x + 5, y - 16);
    ctx.fill();
  }
  const prot = BUILDING_PROTECTION[strong ? 'strongTower' : 'tower'];
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 9px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(prot), x, y + 2);
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
  // Foundation grows with rank
  const w = 10 + rank * 2;
  const h = 8 + rank;
  ctx.fillStyle = '#f1ece3';
  ctx.fillRect(x - w / 2, y - 2, w, h);
  // Roof
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(x - w / 2 - 2, y - 2);
  ctx.lineTo(x, y - 10 - rank);
  ctx.lineTo(x + w / 2 + 2, y - 2);
  ctx.closePath();
  ctx.fill();
  // Door
  ctx.fillStyle = '#5c4033';
  ctx.fillRect(x - 2, y + 1, 4, 5);
  // Windows by rank
  ctx.fillStyle = '#fff3bf';
  for (let i = 0; i < rank; i++) {
    const wx = x - w / 2 + 2 + i * ((w - 4) / Math.max(rank, 1));
    ctx.fillRect(wx, y - 1, 2.5, 2.5);
  }
  // Chimney / barracks mark
  ctx.fillStyle = shade(accent, -40);
  ctx.fillRect(x + w / 2 - 3, y - 8 - rank, 3, 5);
  // Rank label
  ctx.fillStyle = '#212529';
  ctx.font = 'bold 8px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`H${rank}`, x, y + h - 1);

  if (trainLeft !== null) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x + w / 2 + 2, y - 10, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c92a2a';
    ctx.font = 'bold 9px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(trainLeft), x + w / 2 + 2, y - 9.5);
  }
}
