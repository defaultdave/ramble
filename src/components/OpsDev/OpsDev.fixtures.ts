import type { OpsJobRow } from '@/lib/opsDev';

export const pendingRow: OpsJobRow = {
  id: '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
  kind: 'guest-confirmation',
  statusLabel: 'Pending',
  tone: 'info',
  attemptsLabel: '0 of 5',
  runAfterLabel: '2026-11-20 08:00 UTC',
  lastError: null,
  runnable: true,
};

export const retryingRow: OpsJobRow = {
  id: '1f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
  kind: 'refund',
  statusLabel: 'Pending',
  tone: 'info',
  attemptsLabel: '2 of 5',
  runAfterLabel: '2026-11-20 08:30 UTC',
  lastError: 'ProviderUnavailable',
  runnable: true,
};

export const deadRow: OpsJobRow = {
  id: '2f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
  kind: 'guest-confirmation',
  statusLabel: 'Dead',
  tone: 'danger',
  attemptsLabel: '5 of 5',
  runAfterLabel: '2026-11-19 08:00 UTC',
  lastError: 'EmailRefused',
  runnable: false,
};

export const doneRow: OpsJobRow = {
  id: '3f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
  kind: 'noop',
  statusLabel: 'Succeeded',
  tone: 'success',
  attemptsLabel: '1 of 3',
  runAfterLabel: '2026-11-19 07:00 UTC',
  lastError: null,
  runnable: false,
};
