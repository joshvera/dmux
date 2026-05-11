import { describe, expect, it } from 'vitest';
import { scheduleStartupKeyTableNormalization } from '../src/utils/startupKeyTableNormalization.js';

describe('scheduleStartupKeyTableNormalization', () => {
  it('does not schedule work when disabled', () => {
    let scheduled = 0;
    let normalized = 0;

    scheduleStartupKeyTableNormalization({
      enabled: false,
      schedule: () => {
        scheduled++;
      },
      normalize: async () => {
        normalized++;
      },
    });

    expect(scheduled).toBe(0);
    expect(normalized).toBe(0);
  });

  it('returns before running the scheduled normalization', () => {
    const callbacks: Array<() => void> = [];
    let normalized = 0;

    scheduleStartupKeyTableNormalization({
      enabled: true,
      schedule: (callback) => {
        callbacks.push(callback);
      },
      normalize: async () => {
        normalized++;
      },
    });

    expect(callbacks).toHaveLength(1);
    expect(normalized).toBe(0);

    callbacks[0]();

    expect(normalized).toBe(1);
  });

  it('swallows and logs async normalization failures', async () => {
    const callbacks: Array<() => void> = [];
    const logs: Array<{ message: string; source?: string }> = [];

    scheduleStartupKeyTableNormalization({
      enabled: true,
      schedule: (callback) => {
        callbacks.push(callback);
      },
      normalize: async () => {
        throw new Error('tmux retry failed');
      },
      logDebug: (message, source) => {
        logs.push({ message, source });
      },
    });

    callbacks[0]();
    await Promise.resolve();

    expect(logs).toEqual([
      {
        message: 'Startup key table normalization failed: tmux retry failed',
        source: 'tmux',
      },
    ]);
  });

  it('swallows and logs synchronous normalization failures', () => {
    const callbacks: Array<() => void> = [];
    const logs: Array<{ message: string; source?: string }> = [];

    scheduleStartupKeyTableNormalization({
      enabled: true,
      schedule: (callback) => {
        callbacks.push(callback);
      },
      normalize: () => {
        throw new Error('sync tmux failure');
      },
      logDebug: (message, source) => {
        logs.push({ message, source });
      },
    });

    expect(() => callbacks[0]()).not.toThrow();
    expect(logs).toEqual([
      {
        message: 'Startup key table normalization failed: sync tmux failure',
        source: 'tmux',
      },
    ]);
  });
});
