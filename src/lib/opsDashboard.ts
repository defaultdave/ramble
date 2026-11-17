import { opsDashboardCopy } from '@/lib/copy/opsDashboard';
import { count } from './copy/format';
import { reviewPath } from './experienceReview';
import { opsBookingsPath } from './opsBookings';
import { opsRequestsPath } from './opsRequests';
import { opsSessionsPath } from './opsSessions';
import { supportQueuePath } from './supportQueue';

/** How many of the latest audit rows the landing shows. */
export const recentAuditLimit = 5;

/** The count behind each tile. Each is read on its own and is a whole number from zero up. */
export type OpsDashboardCounts = {
  inReview: number;
  refundFailed: number;
  openSupport: number;
  privateRequests: number;
  sessionsToday: number;
};

export type DashboardTile = {
  id: keyof OpsDashboardCounts;
  label: string;
  /** Where the tile's queue is, filtered to what the count counts where the queue has such a filter. */
  href: string;
  count: number;
  /** The count in words, which also says so when it is zero. */
  status: string;
  /** Whether someone has work to do: a count of zero never does, and a tile that only informs never does. */
  needsAttention: boolean;
};

type TileCopy = {
  label: string;
  zero: string;
  noun: string;
  plural: string;
  suffix: string;
};

const tiles: readonly {
  id: keyof OpsDashboardCounts;
  href: string;
  copy: TileCopy;
  actionable: boolean;
}[] = [
  {
    id: 'inReview',
    href: reviewPath,
    copy: opsDashboardCopy.tiles.review,
    actionable: true,
  },
  {
    id: 'refundFailed',
    href: `${opsBookingsPath}?status=refund_failed`,
    copy: opsDashboardCopy.tiles.refundFailed,
    actionable: true,
  },
  {
    id: 'openSupport',
    href: `${supportQueuePath}?status=open`,
    copy: opsDashboardCopy.tiles.support,
    actionable: true,
  },
  {
    id: 'privateRequests',
    href: opsRequestsPath,
    copy: opsDashboardCopy.tiles.privateRequests,
    actionable: false,
  },
  {
    id: 'sessionsToday',
    href: opsSessionsPath,
    copy: opsDashboardCopy.tiles.sessionsToday,
    actionable: false,
  },
];

function statusText(n: number, copy: TileCopy): string {
  if (n === 0) return copy.zero;
  return `${count(n, copy.noun, copy.plural)}${copy.suffix}`;
}

/** The landing's tiles in the order they are shown, each with its count in words. */
export function dashboardTiles(
  counts: OpsDashboardCounts,
): readonly DashboardTile[] {
  return tiles.map(({ id, href, copy, actionable }) => ({
    id,
    label: copy.label,
    href,
    count: counts[id],
    status: statusText(counts[id], copy),
    needsAttention: actionable && counts[id] > 0,
  }));
}
