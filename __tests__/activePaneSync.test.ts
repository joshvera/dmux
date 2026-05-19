import { describe, expect, it } from 'vitest';
import {
  FALLBACK_ACTIVE_PANE_SYNC_INTERVAL_MS,
  getActivePaneSyncIntervalMs,
  HOOK_ACTIVE_PANE_SYNC_INTERVAL_MS,
} from '../src/utils/activePaneSync.js';

describe('active pane sync cadence', () => {
  it('uses slow reconciliation when hook events drive focus updates', () => {
    expect(getActivePaneSyncIntervalMs('hooks')).toBe(HOOK_ACTIVE_PANE_SYNC_INTERVAL_MS);
    expect(HOOK_ACTIVE_PANE_SYNC_INTERVAL_MS).toBe(3000);
  });

  it('uses a bounded fallback cadence without hooks', () => {
    expect(getActivePaneSyncIntervalMs('polling')).toBe(FALLBACK_ACTIVE_PANE_SYNC_INTERVAL_MS);
    expect(getActivePaneSyncIntervalMs('disabled')).toBe(FALLBACK_ACTIVE_PANE_SYNC_INTERVAL_MS);
    expect(FALLBACK_ACTIVE_PANE_SYNC_INTERVAL_MS).toBe(1000);
  });
});
