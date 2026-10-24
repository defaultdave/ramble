export type SpacesStatus = 'open' | 'few-left' | 'sold-out';

const FEW_LEFT_AT_MOST = 3;

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
