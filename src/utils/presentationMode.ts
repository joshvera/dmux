import type { DmuxPane, PresentationMode } from '../types.js';

export const PRESENTATION_MODES = [
  'grid',
  'focus',
] as const satisfies readonly PresentationMode[];

export function isPresentationMode(value: unknown): value is PresentationMode {
  return typeof value === 'string'
    && PRESENTATION_MODES.includes(value as PresentationMode);
}

export function resolvePresentationMode(
  value: unknown
): PresentationMode {
  if (value === 'single-pane') {
    return 'focus';
  }
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

  const visiblePane = panes.find((pane) => !pane.hidden);
  if (visiblePane) {
    return visiblePane;
  }

  if (selectedPane) {
    return selectedPane;
  }

  return panes[0];
}

export function getFallbackPaneAfterHide(
  panes: DmuxPane[],
  hiddenPaneId: string,
  selectedIndex: number
): DmuxPane | undefined {
  if (panes.length === 0) {
    return undefined;
  }

  const hiddenIndex = panes.findIndex((pane) => pane.id === hiddenPaneId);
  const startIndex = Math.min(
    hiddenIndex >= 0 ? hiddenIndex : selectedIndex,
    panes.length - 1
  );

  for (let index = startIndex; index < panes.length; index += 1) {
    if (panes[index]?.id !== hiddenPaneId && !panes[index]?.hidden) {
      return panes[index];
    }
  }

  for (let index = startIndex - 1; index >= 0; index -= 1) {
    if (panes[index]?.id !== hiddenPaneId && !panes[index]?.hidden) {
      return panes[index];
    }
  }

  for (let index = startIndex; index < panes.length; index += 1) {
    if (panes[index]?.id !== hiddenPaneId) {
      return panes[index];
    }
  }

  for (let index = startIndex - 1; index >= 0; index -= 1) {
    if (panes[index]?.id !== hiddenPaneId) {
      return panes[index];
    }
  }

  return panes[hiddenIndex >= 0 ? hiddenIndex : startIndex];
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
    const visibleSelectedPane = panes[Math.min(selectedIndex, panes.length - 1)];
    if (visibleSelectedPane && !visibleSelectedPane.hidden) {
      return visibleSelectedPane;
    }

    for (let index = Math.min(selectedIndex, panes.length - 1); index < panes.length; index += 1) {
      if (!panes[index]?.hidden) {
        return panes[index];
      }
    }

    for (let index = Math.min(selectedIndex, panes.length - 1) - 1; index >= 0; index -= 1) {
      if (!panes[index]?.hidden) {
        return panes[index];
      }
    }

    return undefined;
  }

  for (let index = Math.min(removedIndex, panes.length - 1); index < panes.length; index += 1) {
    if (!panes[index]?.hidden) {
      return panes[index];
    }
  }

  for (let index = Math.min(removedIndex, panes.length - 1) - 1; index >= 0; index -= 1) {
    if (!panes[index]?.hidden) {
      return panes[index];
    }
  }

  return undefined;
}
