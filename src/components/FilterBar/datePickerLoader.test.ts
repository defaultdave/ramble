import { afterEach, describe, expect, it, vi } from 'vitest';

// Behaviours under test:
// - nothing is held until the calendar has been fetched, and then it is the same component the fetch returned
// - a failed fetch rejects, holds nothing, and a later call fetches again

afterEach(() => {
  vi.doUnmock('@/components/DatePicker');
  vi.resetModules();
});

describe('datePickerLoader', () => {
  it('holds nothing until the calendar has been fetched, then holds it', async () => {
    const { loadDatePicker, loadedDatePicker } =
      await import('./datePickerLoader');
    expect(loadedDatePicker()).toBeNull();
    const component = await loadDatePicker();
    expect(loadedDatePicker()).toBe(component);
  });

  it('rejects when the fetch fails and fetches again on a later call', async () => {
    let attempts = 0;
    vi.doMock('@/components/DatePicker', () => ({
      get DatePicker() {
        attempts += 1;
        if (attempts === 1) throw new Error('chunk failed');
        return () => null;
      },
    }));
    const { loadDatePicker, loadedDatePicker } =
      await import('./datePickerLoader');
    await expect(loadDatePicker()).rejects.toThrow('chunk failed');
    expect(loadedDatePicker()).toBeNull();
    expect(await loadDatePicker()).toBeTypeOf('function');
    expect(loadedDatePicker()).not.toBeNull();
  });
});
