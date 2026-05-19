import type { PaneEventMode } from '../services/PaneEventService.js';

export const HOOK_ACTIVE_PANE_SYNC_INTERVAL_MS = 3000;
export const FALLBACK_ACTIVE_PANE_SYNC_INTERVAL_MS = 1000;

export function getActivePaneSyncIntervalMs(eventMode: PaneEventMode): number {
  return eventMode === 'hooks'
    ? HOOK_ACTIVE_PANE_SYNC_INTERVAL_MS
    : FALLBACK_ACTIVE_PANE_SYNC_INTERVAL_MS;
}
