import { describe, expect, it } from 'vitest';
import {
  PANE_TITLE_BUSY_FRAMES,
  PANE_TITLE_BUSY_MARKER,
  PANE_TITLE_IDLE_MARKER,
  getPaneTitlePrefixValue,
  getStablePaneTitlePrefixValue,
} from '../src/utils/paneTitlePrefix.js';
import { createWorktreePane } from './fixtures/mockPanes.js';

describe('pane title prefix helpers', () => {
  it('keeps the stable working prefix fixed while the animated helper changes frames', () => {
    const pane = createWorktreePane({ agentStatus: 'working' });

    expect(getStablePaneTitlePrefixValue(pane, [], '/test/project')).toContain(PANE_TITLE_BUSY_MARKER);
    expect(getStablePaneTitlePrefixValue(pane, [], '/test/project')).toBe(
      getPaneTitlePrefixValue(pane, [], '/test/project', 0)
    );
    expect(getStablePaneTitlePrefixValue(pane, [], '/test/project')).not.toBe(
      getPaneTitlePrefixValue(pane, [], '/test/project', 3)
    );
    expect(getPaneTitlePrefixValue(pane, [], '/test/project', 3)).toContain(PANE_TITLE_BUSY_FRAMES[3]);
  });

  it('preserves idle marker and theme formatting for stable prefixes', () => {
    const idlePane = createWorktreePane({ agentStatus: 'idle' });
    const stableIdlePrefix = getStablePaneTitlePrefixValue(idlePane, [], '/test/project');

    expect(stableIdlePrefix).toContain(PANE_TITLE_IDLE_MARKER);
    expect(stableIdlePrefix).toBe(getPaneTitlePrefixValue(idlePane, [], '/test/project', 4));
    expect(stableIdlePrefix).toMatch(/^#\[fg=[^\]]+\].+#\[default\]$/);
  });
});
