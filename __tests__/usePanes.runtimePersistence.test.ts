import { describe, expect, it } from 'vitest';
import type { DmuxPane } from '../src/types.js';
import { shouldPersistPaneRuntimeConfig } from '../src/hooks/usePanes.js';

function pane(id: string, hidden = false, paneId = `%${id}`): DmuxPane {
  return {
    id,
    slug: `pane-${id}`,
    prompt: '',
    paneId,
    hidden,
  };
}

describe('usePanes runtime persistence decisions', () => {
  it('persists hidden-only changes from tmux topology sync', () => {
    expect(shouldPersistPaneRuntimeConfig({
      loadedPanes: [pane('1', false), pane('2', false)],
      finalPanes: [pane('1', true), pane('2', false)],
      hiddenStateChangedFromConfig: false,
      shellPanesAdded: false,
      shellPanesRemoved: false,
      sidebarProjectsChanged: false,
    })).toBe(true);
  });

  it('persists initial hidden-state corrections reported by loading', () => {
    expect(shouldPersistPaneRuntimeConfig({
      loadedPanes: [pane('1', false)],
      finalPanes: [pane('1', false)],
      hiddenStateChangedFromConfig: true,
      shellPanesAdded: false,
      shellPanesRemoved: false,
      sidebarProjectsChanged: false,
    })).toBe(true);
  });

  it('does not persist when panes only reorder', () => {
    expect(shouldPersistPaneRuntimeConfig({
      loadedPanes: [pane('1', false), pane('2', true)],
      finalPanes: [pane('2', true), pane('1', false)],
      hiddenStateChangedFromConfig: false,
      shellPanesAdded: false,
      shellPanesRemoved: false,
      sidebarProjectsChanged: false,
    })).toBe(false);
  });
});
