import { beforeEach, describe, expect, it, vi } from 'vitest';
import { systemClock } from '@/server/ports/clock';

const realNow = () => systemClock.now().getTime();

const mocks = vi.hoisted(() => ({
  env: {
    VERCEL_ENV: 'preview',
    DEMO_CLOCK: 'on',
    NODE_ENV: 'test',
  },
  readOpsCaller: vi.fn(),
  runJobById: vi.fn(),
  drainJobs: vi.fn(),
  runPulse: vi.fn(),
  readTestClock: vi.fn(),
  writeTestClock: vi.fn(),
}));

class Redirected extends Error {
  constructor(readonly href: string) {
    super(href);
  }
}

vi.mock('next/navigation', () => ({
  redirect: (href: string) => {
    throw new Redirected(href);
  },
}));
vi.mock('@/server/env', () => ({ env: mocks.env }));
vi.mock('@/server/opsCaller', () => ({ readOpsCaller: mocks.readOpsCaller }));
vi.mock('@/server/jobs/drain', () => ({
  runJobById: mocks.runJobById,
  drainJobs: mocks.drainJobs,
}));
vi.mock('@/server/pulse', () => ({ runPulse: mocks.runPulse }));
vi.mock('@/server/testClock', () => ({
  readTestClock: mocks.readTestClock,
  writeTestClock: mocks.writeTestClock,
}));

import {
  drainOpsJobsAction,
  runOpsJobAction,
  runOpsPulseAction,
  setOpsClockAction,
} from './opsDev';

// Behaviours under test:
// - on a production deployment every action goes back to the console page and reads no caller, runs nothing and writes no clock
// - a caller without the ops or admin role (a guest, a host owner, nobody) is sent back the same way and nothing runs; ops and admin are let through
// - run one job: a form with no job id goes back to the page; the job runs on the real clock, or on the test clock when one is set; each outcome has its notice
// - drain and pulse run on the real clock, or on the test clock as `asOf`; a pulse sends no heartbeat; both report their counts in the address
// - a test clock is refused with its notice, and nothing runs, when DEMO_CLOCK is off or the time is out of the 400-day window
// - set, advance and reset write the test clock; advance starts from the stored time; a bad form, or a set the deployment will not run at, writes nothing

const id = '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const ops = { userId: 'u', roles: ['ops'], hostIds: [] };
const admin = { userId: 'a', roles: ['admin'], hostIds: [] };
const refused = [
  ['a guest', { userId: 'g', roles: ['guest'], hostIds: [] }],
  ['a host owner', { userId: 'h', roles: ['host_owner'], hostIds: ['x'] }],
  ['nobody', { userId: null, roles: [], hostIds: [] }],
] as const;
const counts = {
  claimed: 2,
  succeeded: 2,
  retried: 0,
  dead: 0,
  lost: 0,
  unrecorded: 0,
  left: 0,
};

function form(fields: Record<string, string> = {}) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

async function hrefOf(call: () => Promise<void>): Promise<string> {
  try {
    await call();
  } catch (error) {
    if (error instanceof Redirected) return error.href;
    throw error;
  }
  throw new Error('did not redirect');
}

const actions = [
  ['run one job', () => runOpsJobAction(form({ jobId: id }))],
  ['drain', () => drainOpsJobsAction()],
  ['pulse', () => runOpsPulseAction()],
  ['clock', () => setOpsClockAction(form({ intent: 'reset' }))],
] as const;

function expectNothingDone() {
  expect(mocks.runJobById).not.toHaveBeenCalled();
  expect(mocks.drainJobs).not.toHaveBeenCalled();
  expect(mocks.runPulse).not.toHaveBeenCalled();
  expect(mocks.writeTestClock).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.VERCEL_ENV = 'preview';
  mocks.env.DEMO_CLOCK = 'on';
  mocks.readOpsCaller.mockResolvedValue(ops);
  mocks.readTestClock.mockResolvedValue(undefined);
  mocks.runJobById.mockResolvedValue('succeeded');
  mocks.drainJobs.mockResolvedValue(counts);
  mocks.runPulse.mockResolvedValue({
    ...counts,
    purged: 0,
    holdsReleased: 1,
    holdsScrubbed: 0,
    sessionsCreated: 5,
  });
});

describe.each(actions)('%s on a production deployment', (_name, act) => {
  it('goes back to the page, having read no caller and done nothing', async () => {
    mocks.env.VERCEL_ENV = 'production';
    expect(await hrefOf(act)).toBe('/ops/dev');
    expect(mocks.readOpsCaller).not.toHaveBeenCalled();
    expectNothingDone();
  });
});

describe.each(actions)('%s for a caller without the role', (_name, act) => {
  it.each(refused)('sends %s back and does nothing', async (_who, caller) => {
    mocks.readOpsCaller.mockResolvedValue(caller);
    expect(await hrefOf(act)).toBe('/ops/dev');
    expectNothingDone();
  });
});

describe('who may use the console', () => {
  it.each([
    ['ops', ops],
    ['admin', admin],
  ])('lets %s run the queue', async (_who, caller) => {
    mocks.readOpsCaller.mockResolvedValue(caller);
    expect(await hrefOf(() => drainOpsJobsAction())).toContain(
      'notice=drained',
    );
    expect(mocks.drainJobs).toHaveBeenCalledTimes(1);
  });
});

describe('runOpsJobAction', () => {
  it('goes back to the page for a form with no job id, and runs nothing', async () => {
    expect(await hrefOf(() => runOpsJobAction(form()))).toBe('/ops/dev');
    expect(mocks.runJobById).not.toHaveBeenCalled();
  });

  it.each([
    ['succeeded', 'run_succeeded'],
    ['retried', 'run_retried'],
    ['dead', 'run_dead'],
    ['lost', 'run_lost'],
    ['not_runnable', 'run_not_runnable'],
  ])('a job that %s ends on %s', async (outcome, notice) => {
    mocks.runJobById.mockResolvedValue(outcome);
    expect(await hrefOf(() => runOpsJobAction(form({ jobId: id })))).toBe(
      `/ops/dev?notice=${notice}`,
    );
  });

  it('runs on the real clock when no test clock is set', async () => {
    await hrefOf(() => runOpsJobAction(form({ jobId: id })));
    const [jobId, clock] = mocks.runJobById.mock.calls[0] as [
      string,
      { now: () => Date },
    ];
    expect(jobId).toBe(id);
    expect(Math.abs(clock.now().getTime() - realNow())).toBeLessThan(5000);
  });

  it('runs on the test clock when one is set', async () => {
    const at = new Date(realNow() + 2 * 86_400_000);
    mocks.readTestClock.mockResolvedValue(at);
    await hrefOf(() => runOpsJobAction(form({ jobId: id })));
    const [, clock] = mocks.runJobById.mock.calls[0] as [
      string,
      { now: () => Date },
    ];
    expect(clock.now()).toEqual(at);
  });
});

describe('drainOpsJobsAction and runOpsPulseAction', () => {
  it('drain reports its counts in the address', async () => {
    expect(await hrefOf(() => drainOpsJobsAction())).toBe(
      '/ops/dev?notice=drained&claimed=2&succeeded=2&retried=0&dead=0&lost=0&left=0',
    );
  });

  it('pulse runs with no asOf and no heartbeat on the real clock, and reports its counts', async () => {
    const href = await hrefOf(() => runOpsPulseAction());
    expect(mocks.runPulse).toHaveBeenCalledWith(undefined, false);
    expect(href).toContain('notice=pulsed');
    expect(href).toContain('holdsReleased=1');
    expect(href).toContain('sessionsCreated=5');
  });

  it('pulse takes the test clock as its asOf', async () => {
    const at = new Date(realNow() + 86_400_000);
    mocks.readTestClock.mockResolvedValue(at);
    await hrefOf(() => runOpsPulseAction());
    expect(mocks.runPulse).toHaveBeenCalledWith(at, false);
  });

  it('drain runs on the test clock', async () => {
    const at = new Date(realNow() + 86_400_000);
    mocks.readTestClock.mockResolvedValue(at);
    await hrefOf(() => drainOpsJobsAction());
    const [clock] = mocks.drainJobs.mock.calls[0] as [{ now: () => Date }];
    expect(clock.now()).toEqual(at);
  });

  it.each(actions.slice(0, 3))(
    '%s refuses a test clock while DEMO_CLOCK is off, and runs nothing',
    async (_name, act) => {
      mocks.env.DEMO_CLOCK = 'off';
      mocks.readTestClock.mockResolvedValue(new Date(realNow() + 86_400_000));
      expect(await hrefOf(act)).toBe('/ops/dev?notice=clock_off');
      expectNothingDone();
    },
  );

  it.each(actions.slice(0, 3))(
    '%s refuses a test clock more than 400 days away, and runs nothing',
    async (_name, act) => {
      mocks.readTestClock.mockResolvedValue(
        new Date(realNow() + 401 * 86_400_000),
      );
      expect(await hrefOf(act)).toBe('/ops/dev?notice=clock_out_of_range');
      expectNothingDone();
    },
  );

  it('runs on the real clock while DEMO_CLOCK is off and no test clock is set', async () => {
    mocks.env.DEMO_CLOCK = 'off';
    expect(await hrefOf(() => drainOpsJobsAction())).toContain(
      'notice=drained',
    );
  });
});

describe('setOpsClockAction', () => {
  it('sets the time a tester names, read as UTC', async () => {
    const at = new Date(realNow() + 3 * 86_400_000);
    const local = at.toISOString().slice(0, 16);
    expect(
      await hrefOf(() => setOpsClockAction(form({ intent: 'set', at: local }))),
    ).toBe('/ops/dev?notice=clock_set');
    expect(mocks.writeTestClock).toHaveBeenCalledWith(
      new Date(`${local}:00.000Z`),
    );
  });

  it('advances from the real time when no test clock is set', async () => {
    const before = realNow();
    await hrefOf(() =>
      setOpsClockAction(form({ intent: 'advance', amount: '2', unit: 'days' })),
    );
    const [written] = mocks.writeTestClock.mock.calls[0] as [Date];
    expect(written.getTime() - before).toBeGreaterThanOrEqual(2 * 86_400_000);
    expect(written.getTime() - before).toBeLessThan(2 * 86_400_000 + 5000);
  });

  it('advances from the stored test time', async () => {
    const stored = new Date(realNow() + 86_400_000);
    mocks.readTestClock.mockResolvedValue(stored);
    await hrefOf(() =>
      setOpsClockAction(
        form({ intent: 'advance', amount: '3', unit: 'hours' }),
      ),
    );
    expect(mocks.writeTestClock).toHaveBeenCalledWith(
      new Date(stored.getTime() + 3 * 3_600_000),
    );
  });

  it('resets, even while DEMO_CLOCK is off', async () => {
    mocks.env.DEMO_CLOCK = 'off';
    expect(
      await hrefOf(() => setOpsClockAction(form({ intent: 'reset' }))),
    ).toBe('/ops/dev?notice=clock_reset');
    expect(mocks.writeTestClock).toHaveBeenCalledWith(null);
  });

  it('refuses a set while DEMO_CLOCK is off, and writes nothing', async () => {
    mocks.env.DEMO_CLOCK = 'off';
    const local = new Date(realNow() + 86_400_000).toISOString().slice(0, 16);
    expect(
      await hrefOf(() => setOpsClockAction(form({ intent: 'set', at: local }))),
    ).toBe('/ops/dev?notice=clock_off');
    expect(mocks.writeTestClock).not.toHaveBeenCalled();
  });

  it('refuses a time more than 400 days away, and writes nothing', async () => {
    expect(
      await hrefOf(() =>
        setOpsClockAction(
          form({ intent: 'advance', amount: '401', unit: 'days' }),
        ),
      ),
    ).toBe('/ops/dev?notice=clock_out_of_range');
    expect(mocks.writeTestClock).not.toHaveBeenCalled();
  });

  it('refuses a bad form, and writes nothing', async () => {
    expect(
      await hrefOf(() => setOpsClockAction(form({ intent: 'set', at: 'x' }))),
    ).toBe('/ops/dev?notice=invalid');
    expect(mocks.writeTestClock).not.toHaveBeenCalled();
  });
});
