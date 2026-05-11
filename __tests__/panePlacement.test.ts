import { describe, expect, it } from 'vitest';
import { getPreferredSplitTargetPaneId } from '../src/utils/panePlacement.js';

describe('getPreferredSplitTargetPaneId', () => {
  it('prefers the last visible pane when hidden panes trail the list', () => {
    expect(getPreferredSplitTargetPaneId([
      { paneId: '%1' },
      { paneId: '%2', hidden: true },
      { paneId: '%3', hidden: true },
    ], '%0')).toBe('%1');
  });

  it('falls back to the control pane when all work panes are hidden', () => {
    expect(getPreferredSplitTargetPaneId([
      { paneId: '%1', hidden: true },
      { paneId: '%2', hidden: true },
    ], '%0')).toBe('%0');
  });

  it('falls back to the last existing pane when no control pane is available', () => {
    expect(getPreferredSplitTargetPaneId([
      { paneId: '%1', hidden: true },
      { paneId: '%2', hidden: true },
    ])).toBe('%2');
  });
});
