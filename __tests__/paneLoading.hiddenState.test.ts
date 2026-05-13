import { describe, expect, it } from 'vitest';
import type { DmuxPane } from '../src/types.js';
import { syncLoadedPaneStateFromTmux } from '../src/hooks/usePaneLoading.js';

function pane(overrides: Partial<DmuxPane> = {}): DmuxPane {
  return {
    id: 'dmux-1',
    slug: 'feature',
    prompt: 'prompt',
    paneId: '%1',
    hidden: false,
    projectRoot: '/repo',
    ...overrides,
  };
}

describe('loaded pane runtime state sync', () => {
  it('reports hidden-state changes when config visibility is stale', () => {
    const result = syncLoadedPaneStateFromTmux(
      [pane()],
      {
        allPaneIds: ['%0', '%1'],
        titleToId: new Map([['feature', '%1']]),
        currentWindowPaneIds: ['%0'],
      },
      '/repo'
    );

    expect(result.hiddenStateChangedFromConfig).toBe(true);
    expect(result.panes).toEqual([
      expect.objectContaining({
        id: 'dmux-1',
        paneId: '%1',
        hidden: true,
      }),
    ]);
  });

  it('does not report changes when tmux topology matches config', () => {
    const result = syncLoadedPaneStateFromTmux(
      [pane()],
      {
        allPaneIds: ['%0', '%1'],
        titleToId: new Map([['feature', '%1']]),
        currentWindowPaneIds: ['%0', '%1'],
      },
      '/repo'
    );

    expect(result.hiddenStateChangedFromConfig).toBe(false);
    expect(result.panes).toEqual([
      expect.objectContaining({
        id: 'dmux-1',
        paneId: '%1',
        hidden: false,
      }),
    ]);
  });

  it('rebinds pane ids before syncing hidden state', () => {
    const result = syncLoadedPaneStateFromTmux(
      [pane({ paneId: '%old' })],
      {
        allPaneIds: ['%0', '%2'],
        titleToId: new Map([['feature', '%2']]),
        currentWindowPaneIds: ['%0', '%2'],
      },
      '/repo'
    );

    expect(result.hiddenStateChangedFromConfig).toBe(false);
    expect(result.panes).toEqual([
      expect.objectContaining({
        id: 'dmux-1',
        paneId: '%2',
        hidden: false,
      }),
    ]);
  });
});
