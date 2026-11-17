import { isValidElement, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { id } from '../../../../../../../tests/support/ids';

const mocks = vi.hoisted(() => ({
  loadHostCancel: vi.fn(),
}));

class Redirected extends Error {
  constructor(readonly href: string) {
    super(href);
  }
}

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not found');
  },
  redirect: (href: string) => {
    throw new Redirected(href);
  },
}));
vi.mock('@/server/hostCancelSession', () => ({
  loadHostCancel: mocks.loadHostCancel,
}));
vi.mock('@/server/actions/hostCancelSession', () => ({
  cancelHostSessionAction: vi.fn(),
}));

import { ActionNotice } from '@/components/ActionNotice';
import { HostCancelSession } from '@/components/HostCancelSession';
import { ready } from '@/components/HostCancelSession/HostCancelSession.fixtures';
import HostCancelSessionPage from './page';

// Behaviours under test:
// - nobody signed in goes to sign in and comes back to this page
// - anyone refused (staff, another host, a guest, a session that is not there) gets the not-found page, so the address says nothing
// - the owner sees the cancel view for the session the address names, with the notice the address carries

const props = (query: Record<string, string> = {}) => ({
  params: Promise.resolve({ id: id(5) }),
  searchParams: Promise.resolve(query),
});

beforeEach(() => vi.resetAllMocks());

describe('HostCancelSessionPage', () => {
  it('sends nobody signed in to sign in and back', async () => {
    mocks.loadHostCancel.mockResolvedValue({ status: 'signed_out' });
    await expect(HostCancelSessionPage(props())).rejects.toMatchObject({
      href: `/sign-in?next=${encodeURIComponent(`/host/sessions/${id(5)}/cancel`)}`,
    });
  });

  it('answers not found to a caller who is refused', async () => {
    mocks.loadHostCancel.mockResolvedValue({ status: 'refused' });
    await expect(HostCancelSessionPage(props())).rejects.toThrow('not found');
  });

  it('shows the owner the view of the session named, and the notice named', async () => {
    mocks.loadHostCancel.mockResolvedValue({ status: 'ok', view: ready });
    const page = await HostCancelSessionPage(props({ notice: 'stale' }));

    expect(mocks.loadHostCancel).toHaveBeenCalledWith(id(5));
    const [notice, view] = (page as ReactElement<{ children: unknown[] }>).props
      .children as ReactElement<{ view?: unknown; notice?: unknown }>[];
    expect(isValidElement(notice) && notice.type).toBe(ActionNotice);
    expect(notice?.props.notice).toMatchObject({ tone: 'warning' });
    expect(isValidElement(view) && view.type).toBe(HostCancelSession);
    expect(view?.props.view).toBe(ready);
  });

  it('shows no notice when the address names none', async () => {
    mocks.loadHostCancel.mockResolvedValue({ status: 'ok', view: ready });
    const page = await HostCancelSessionPage(props());
    const [notice] = (page as ReactElement<{ children: unknown[] }>).props
      .children as ReactElement<{ notice?: unknown }>[];
    expect(notice?.props.notice).toBeNull();
  });
});
