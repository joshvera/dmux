import type { DmuxPane, PresentationMode } from '../types.js';

export const PRESENTATION_MODES = [
  'grid',
  'single-pane',
  'focus',
] as const satisfies readonly PresentationMode[];

export function isPresentationMode(value: unknown): value is PresentationMode {
  return typeof value === 'string'
    && PRESENTATION_MODES.includes(value as PresentationMode);
}

export function resolvePresentationMode(
  value: unknown
): PresentationMode {
  return isPresentationMode(value) ? value : 'grid';
}

export function getPresentationTargetPane(
  panes: DmuxPane[],
  selectedIndex: number
): DmuxPane | undefined {
  const selectedPane = panes[selectedIndex];
  if (selectedPane && !selectedPane.hidden) {
    return selectedPane;
  }

  return panes.find((pane) => !pane.hidden);
}

export function getFallbackPaneAfterRemoval(
  panes: DmuxPane[],
  removedPaneId: string,
  selectedIndex: number
): DmuxPane | undefined {
  if (panes.length === 0) {
    return undefined;
  }

  const removedIndex = panes.findIndex((pane) => pane.paneId === removedPaneId);
  if (removedIndex === -1) {
    return panes[Math.min(selectedIndex, panes.length - 1)];
  }

  const fallbackIndex = Math.min(removedIndex, panes.length - 1);
  return panes[fallbackIndex];
}
