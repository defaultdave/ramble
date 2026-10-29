export type SpacesStatus = 'open' | 'few-left' | 'sold-out';

const FEW_LEFT_AT_MOST = 3;

type SessionSpace = { allocation: number; seatsSold: number };

export function spacesLeft({ allocation, seatsSold }: SessionSpace): number {
  return allocation - seatsSold;
}

/** Sold out is `spacesStatus` at no spaces left or fewer, so a session with an allocation of 0 has none. */
export function hasSpaceLeft(session: SessionSpace): boolean {
  return spacesStatus(spacesLeft(session)) !== 'sold-out';
}

export function spacesStatus(spacesLeft: number): SpacesStatus {
  if (spacesLeft <= 0) return 'sold-out';
  return spacesLeft <= FEW_LEFT_AT_MOST ? 'few-left' : 'open';
}

export function spacesLabel(spacesLeft: number): string {
  const status = spacesStatus(spacesLeft);
  if (status === 'sold-out') return 'Sold out';
  const count = String(spacesLeft);
  return status === 'few-left' ? `${count} left` : `${count} spaces`;
}
