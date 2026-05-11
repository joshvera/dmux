import { describe, expect, it } from 'vitest';
import type { DmuxPane } from '../src/types.js';
import {
  getFallbackPaneAfterHide,
  getFallbackPaneAfterRemoval,
  getPresentationTargetPane,
  resolvePresentationMode,
} from '../src/utils/presentationMode.js';

function pane(id: string, hidden = false): DmuxPane {
  return {
    id,
    slug: `pane-${id}`,
    prompt: `prompt-${id}`,
    paneId: `%${id}`,
    hidden,
  };
}

describe('presentationMode helpers', () => {
  it('maps legacy single-pane mode to focus and falls back to grid for unknown values', () => {
    expect(resolvePresentationMode('grid')).toBe('grid');
    expect(resolvePresentationMode('single-pane')).toBe('focus');
    expect(resolvePresentationMode('focus')).toBe('focus');
    expect(resolvePresentationMode('unknown')).toBe('grid');
  });

  it('prefers the selected visible pane, then falls back to the first visible pane', () => {
    const panes = [
      pane('1', true),
      pane('2', false),
      pane('3', false),
    ];

    expect(getPresentationTargetPane(panes, 2)?.id).toBe('3');
    expect(getPresentationTargetPane(panes, 9)?.id).toBe('2');
    expect(getPresentationTargetPane(panes, 0)?.id).toBe('2');
  });

  it('falls back to a hidden pane when no visible panes remain', () => {
    expect(getPresentationTargetPane([pane('4', true)], 0)?.id).toBe('4');
    expect(
      getPresentationTargetPane([pane('1', true), pane('2', true)], 1)?.id
    ).toBe('2');
    expect(
      getPresentationTargetPane([pane('1', true), pane('2', true)], 9)?.id
    ).toBe('1');
  });

  it('prefers another visible pane after hiding the selected pane', () => {
    expect(
      getFallbackPaneAfterHide([pane('1', true), pane('2')], '1', 0)?.id
    ).toBe('2');
    expect(
      getFallbackPaneAfterHide([pane('1'), pane('2', true), pane('3')], '2', 1)?.id
    ).toBe('3');
  });

  it('falls back to a hidden sibling after hide when no visible alternative remains', () => {
    expect(
      getFallbackPaneAfterHide([pane('1', true), pane('2', true)], '1', 0)?.id
    ).toBe('2');
    expect(
      getFallbackPaneAfterHide([pane('1', true), pane('2', true), pane('3', true)], '2', 1)?.id
    ).toBe('3');
  });

  it('only falls back to the same pane after hide when it is the sole remaining pane', () => {
    expect(getFallbackPaneAfterHide([pane('1', true)], '1', 0)?.id).toBe('1');
  });

  it('returns the nearest remaining visible pane after removal', () => {
    const panes = [pane('1'), pane('2'), pane('3')];

    expect(getFallbackPaneAfterRemoval(panes, '%2', 1)?.id).toBe('2');
    expect(getFallbackPaneAfterRemoval(panes.slice(0, 2), '%3', 5)?.id).toBe('2');
    expect(getFallbackPaneAfterRemoval([], '%1', 0)).toBeUndefined();
  });

  it('skips hidden panes when choosing a fallback after removal', () => {
    expect(
      getFallbackPaneAfterRemoval([pane('1'), pane('2', true), pane('3')], '%removed', 1)?.id
    ).toBe('3');
    expect(
      getFallbackPaneAfterRemoval([pane('1'), pane('2', true), pane('3', true)], '%removed', 2)?.id
    ).toBe('1');
    expect(getFallbackPaneAfterRemoval([pane('1', true), pane('2', true)], '%1', 0)).toBeUndefined();
  });
});
