import { isValidElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: { VERCEL_ENV: 'preview', DEMO_CLOCK: 'on' },
  readOpsCaller: vi.fn(),
  readRecentJobs: vi.fn(),
  readTestClock: vi.fn(),
}));

vi.mock('@/server/env', () => ({ env: mocks.env }));
vi.mock('@/server/opsCaller', () => ({ readOpsCaller: mocks.readOpsCaller }));
vi.mock('@/server/db/opsJobs', () => ({
  readRecentJobs: mocks.readRecentJobs,
}));
vi.mock('@/server/testClock', () => ({ readTestClock: mocks.readTestClock }));
vi.mock('@/server/actions/opsDev', () => ({
  drainOpsJobsAction: vi.fn(),
  runOpsJobAction: vi.fn(),
  runOpsPulseAction: vi.fn(),
  setOpsClockAction: vi.fn(),
}));

import { OpsDevConsole } from '@/components/OpsDev';
import { OpsAccessDenied } from '@/components/OpsShell';
import OpsDevPage from './page';

// Behaviours under test:
// - a caller without the ops or admin role (a guest, nobody) gets the access-denied view and no job is read
// - on a production deployment even ops gets a plain refusal, and no job is read
// - ops and admin on a testing deployment get the console, with the jobs read and the stored test time shown
// - the console is told whether DEMO_CLOCK is on

const props = (query: Record<string, string> = {}) => ({
  params: Promise.resolve({}),
  searchParams: Promise.resolve(query),
});

function findConsole(node: unknown): React.ReactElement | null {
  if (!isValidElement(node)) return null;
  if (node.type === OpsDevConsole) return node;
  const { children } = node.props as { children?: unknown };
  for (const child of [children].flat()) {
    const found = findConsole(child);
    if (found) return found;
  }
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.VERCEL_ENV = 'preview';
  mocks.env.DEMO_CLOCK = 'on';
  mocks.readRecentJobs.mockResolvedValue([]);
  mocks.readTestClock.mockResolvedValue(undefined);
});

describe('the test console page', () => {
  it.each([
    ['a guest', { userId: 'g', roles: ['guest'], hostIds: [] }],
    ['nobody', { userId: null, roles: [], hostIds: [] }],
  ])('shows %s the access-denied view and reads nothing', async (_who, who) => {
    mocks.readOpsCaller.mockResolvedValue(who);
    const page = await OpsDevPage(props());
    expect(isValidElement(page) && page.type).toBe(OpsAccessDenied);
    expect(mocks.readRecentJobs).not.toHaveBeenCalled();
  });

  it('refuses ops on a production deployment and reads nothing', async () => {
    mocks.env.VERCEL_ENV = 'production';
    mocks.readOpsCaller.mockResolvedValue({
      userId: 'u',
      roles: ['ops'],
      hostIds: [],
    });
    const page = await OpsDevPage(props());
    expect(findConsole(page)).toBeNull();
    expect(JSON.stringify(page)).toContain('not available');
    expect(mocks.readRecentJobs).not.toHaveBeenCalled();
    expect(mocks.readTestClock).not.toHaveBeenCalled();
  });

  it.each(['ops', 'admin'])(
    'gives %s the console with the jobs and the test time',
    async (role) => {
      mocks.readOpsCaller.mockResolvedValue({
        userId: 'u',
        roles: [role],
        hostIds: [],
      });
      mocks.readTestClock.mockResolvedValue(
        new Date('2026-11-20T08:00:00.000Z'),
      );
      const found = findConsole(await OpsDevPage(props()));
      expect(found?.props).toMatchObject({
        rows: [],
        testTimeLabel: '2026-11-20 08:00 UTC',
        demoClockOn: true,
      });
    },
  );

  it('tells the console when the demo clock is off', async () => {
    mocks.env.DEMO_CLOCK = 'off';
    mocks.readOpsCaller.mockResolvedValue({
      userId: 'u',
      roles: ['ops'],
      hostIds: [],
    });
    const found = findConsole(await OpsDevPage(props()));
    expect(found?.props).toMatchObject({
      testTimeLabel: null,
      demoClockOn: false,
    });
  });
});
