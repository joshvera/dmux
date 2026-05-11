import type { DmuxPane } from '../types.js';

export function getPreferredSplitTargetPaneId(
  existingPanes: ReadonlyArray<Pick<DmuxPane, 'paneId' | 'hidden'>>,
  controlPaneId?: string
): string | undefined {
  for (let index = existingPanes.length - 1; index >= 0; index -= 1) {
    const pane = existingPanes[index];
    if (!pane.hidden) {
      return pane.paneId;
    }
  }

  return controlPaneId || existingPanes[existingPanes.length - 1]?.paneId;
}
