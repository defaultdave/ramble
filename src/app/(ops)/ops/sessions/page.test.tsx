import { isValidElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readOpsCaller: vi.fn(),
  readOpsSessions: vi.fn(),
  readOpsSession: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('not found');
  }),
}));

vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));
vi.mock('@/server/opsCaller', () => ({ readOpsCaller: mocks.readOpsCaller }));
vi.mock('@/server/db/opsSessions', () => ({
  readOpsSessions: mocks.readOpsSessions,
  readOpsSession: mocks.readOpsSession,
}));
vi.mock('@/server/actions/opsSessions', () => ({
  cancelOpsSessionAction: vi.fn(),
}));

import { OpsAccessDenied } from '@/components/OpsShell';
import SessionPage from './[sessionId]/page';
import SessionsPage from './page';

// Behaviours under test:
// - a caller without the ops role (a guest, an admin, nobody) gets the access-denied view on both pages and nothing is read
// - an ops caller reads the list by the filter, search term and cursor the address names
// - the session page reads the session the address names, and answers not found for an id that is no session

const ops = { userId: 'u', roles: ['ops'], hostIds: [] };
const id = '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const notOps = [
  ['a guest', { userId: 'g', roles: ['guest'], hostIds: [] }],
  ['an admin', { userId: 'a', roles: ['admin'], hostIds: [] }],
  ['nobody', { userId: null, roles: [], hostIds: [] }],
] as const;

const listProps = (query: Record<string, string>) => ({
  params: Promise.resolve({}),
  searchParams: Promise.resolve(query),
});
const detailProps = (
  sessionId: string,
  query: Record<string, string> = {},
) => ({
  params: Promise.resolve({ sessionId }),
  searchParams: Promise.resolve(query),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readOpsSessions.mockResolvedValue({ rows: [], nextCursor: null });
});

describe.each(notOps)('for %s', (_who, caller) => {
  beforeEach(() => mocks.readOpsCaller.mockResolvedValue(caller));

  it('shows the access-denied view and reads nothing', async () => {
    const list = await SessionsPage(listProps({}));
    const detail = await SessionPage(detailProps(id));
    expect(isValidElement(list) && list.type).toBe(OpsAccessDenied);
    expect(isValidElement(detail) && detail.type).toBe(OpsAccessDenied);
    expect(mocks.readOpsSessions).not.toHaveBeenCalled();
    expect(mocks.readOpsSession).not.toHaveBeenCalled();
  });
});

describe('the sessions pages for ops', () => {
  beforeEach(() => mocks.readOpsCaller.mockResolvedValue(ops));

  it('reads the list by the filter, search and cursor in the address', async () => {
    await SessionsPage(listProps({ status: 'past', q: ' kayak ', cursor: id }));
    expect(mocks.readOpsSessions).toHaveBeenCalledWith(ops, {
      when: 'past',
      term: 'kayak',
      cursor: id,
    });
  });

  it('reads the session the address names', async () => {
    mocks.readOpsSession.mockResolvedValue(null);
    await expect(SessionPage(detailProps(id))).rejects.toThrow('not found');
    expect(mocks.readOpsSession).toHaveBeenCalledWith(ops, id);
  });

  it('answers not found for an id that is no id, without reading', async () => {
    await expect(SessionPage(detailProps('nope'))).rejects.toThrow('not found');
    expect(mocks.readOpsSession).not.toHaveBeenCalled();
  });
});
