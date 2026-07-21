import type { HexCell, Player, Province, Unit } from './types';

function cloneUnit(unit: Unit | null): Unit | null {
  return unit ? { ...unit } : null;
}

function cloneCell(cell: HexCell): HexCell {
  return {
    q: cell.q,
    r: cell.r,
    owner: cell.owner,
    unit: cloneUnit(cell.unit),
    building: cell.building,
    tree: cell.tree,
    palm: cell.palm,
    training: cell.training ? { ...cell.training } : null,
    elevation: cell.elevation ?? 0.5,
  };
}

/** Faster than structuredClone for our flat game state. */
export function cloneCells(cells: Record<string, HexCell>): Record<string, HexCell> {
  const out: Record<string, HexCell> = Object.create(null);
  for (const key in cells) {
    out[key] = cloneCell(cells[key]);
  }
  return out;
}

export function cloneProvinces(provinces: Province[]): Province[] {
  return provinces.map((p) => ({
    id: p.id,
    owner: p.owner,
    hexes: p.hexes.slice(),
    capitalKey: p.capitalKey,
    money: p.money,
  }));
}

export function clonePlayers(players: Player[]): Player[] {
  return players.map((p) => ({ ...p }));
}
