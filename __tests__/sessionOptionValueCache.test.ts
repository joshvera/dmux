import { describe, expect, it, vi } from 'vitest';
import {
  createSessionOptionValueCacheEntry,
  setSessionOptionValueIfChanged,
  shouldSetSessionOptionValue,
} from '../src/utils/sessionOptionValueCache.js';

describe('sessionOptionValueCache', () => {
  it('keys cache hits by session name and desired value', () => {
    const cached = createSessionOptionValueCacheEntry('dmux-a', 'fg=colour39');

    expect(shouldSetSessionOptionValue(cached, 'dmux-a', 'fg=colour39')).toBe(false);
    expect(shouldSetSessionOptionValue(cached, 'dmux-a', 'fg=colour40')).toBe(true);
    expect(shouldSetSessionOptionValue(cached, 'dmux-b', 'fg=colour39')).toBe(true);
    expect(shouldSetSessionOptionValue(null, 'dmux-a', 'fg=colour39')).toBe(true);
  });

  it('updates cache only after a successful tmux write', () => {
    const cached = createSessionOptionValueCacheEntry('dmux-a', 'fg=colour39');
    const failedWrite = vi.fn(() => false);
    const successfulWrite = vi.fn(() => true);

    expect(setSessionOptionValueIfChanged({
      cached,
      sessionName: 'dmux-a',
      value: 'fg=colour40',
      setValue: failedWrite,
    })).toBe(cached);
    expect(failedWrite).toHaveBeenCalledTimes(1);

    expect(setSessionOptionValueIfChanged({
      cached,
      sessionName: 'dmux-a',
      value: 'fg=colour40',
      setValue: successfulWrite,
    })).toEqual({
      sessionName: 'dmux-a',
      value: 'fg=colour40',
    });
    expect(successfulWrite).toHaveBeenCalledTimes(1);
  });

  it('suppresses no-op writes', () => {
    const cached = createSessionOptionValueCacheEntry('dmux-a', 'fg=colour39');
    const setValue = vi.fn(() => true);

    expect(setSessionOptionValueIfChanged({
      cached,
      sessionName: 'dmux-a',
      value: 'fg=colour39',
      setValue,
    })).toBe(cached);
    expect(setValue).not.toHaveBeenCalled();
  });
});
