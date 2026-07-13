import type { Player, PlayerId } from './types';

/** Players with the same teamId are allies (teamId starts at 1). */
export function teamOf(players: Player[], id: PlayerId): number {
  return players.find((p) => p.id === id)?.teamId ?? id;
}

export function isAlly(players: Player[], a: PlayerId, b: PlayerId): boolean {
  if (a === 0 || b === 0) return false;
  if (a === b) return true;
  return teamOf(players, a) === teamOf(players, b);
}

export function isEnemy(players: Player[], a: PlayerId, b: PlayerId): boolean {
  if (b === 0) return true; // neutral is capturable
  if (a === 0) return false;
  return !isAlly(players, a, b);
}

export function alliesOf(players: Player[], id: PlayerId): Player[] {
  const team = teamOf(players, id);
  return players.filter((p) => p.id !== id && p.alive && p.teamId === team);
}

export function teamLabel(teamId: number): string {
  return `Команда ${teamId}`;
}
