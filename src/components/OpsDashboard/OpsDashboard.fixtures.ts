import { dashboardTiles, type OpsDashboardCounts } from '@/lib/opsDashboard';
import type { AuditViewRow } from '@/lib/staffAdmin';

export const busyCounts: OpsDashboardCounts = {
  inReview: 3,
  refundFailed: 1,
  openSupport: 12,
  privateRequests: 7,
  sessionsToday: 5,
};

export const quietCounts: OpsDashboardCounts = {
  inReview: 0,
  refundFailed: 0,
  openSupport: 0,
  privateRequests: 0,
  sessionsToday: 0,
};

export const busyTiles = dashboardTiles(busyCounts);
export const quietTiles = dashboardTiles(quietCounts);

export const auditRows: AuditViewRow[] = [
  {
    id: '41',
    time: '2026-11-17 14:02 UTC',
    actor: 'ops 5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10',
    action: 'ops.accessed',
    subject: 'area ops',
    details: '—',
  },
  {
    id: '40',
    time: '2026-11-17 13:40 UTC',
    actor: 'ops 5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10',
    action: 'support.resolved',
    subject: 'support_request 0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
    details: '—',
  },
];
