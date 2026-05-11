import { describe, expect, it } from 'vitest';
import type { DmuxPane } from '../src/types.js';
import type { ProjectActionItem } from '../src/utils/projectActions.js';
import { resolveControlPaneSelection } from '../src/utils/controlPaneFocus.js';

function pane(id: string, projectRoot = '/repo'): DmuxPane {
  return {
    id,
    slug: `pane-${id}`,
    prompt: `prompt-${id}`,
    paneId: `%${id}`,
    projectRoot,
    projectName: projectRoot.split('/').pop() || 'repo',
    worktreePath: `${projectRoot}/.dmux/worktrees/pane-${id}`,
  };
}

describe('resolveControlPaneSelection', () => {
  const actions: ProjectActionItem[] = [
    {
      index: 2,
      projectRoot: '/repo',
      projectName: 'repo',
      kind: 'new-agent',
      hotkey: 'n',
    },
    {
      index: 3,
      projectRoot: '/repo-other',
      projectName: 'repo-other',
      kind: 'new-agent',
      hotkey: 'n',
    },
  ];

  it('keeps an existing project action selection', () => {
    expect(resolveControlPaneSelection(2, [pane('1')], actions, '/repo')).toBe(2);
  });

  it('moves stale pane selection to the pane project action', () => {
    expect(
      resolveControlPaneSelection(
        1,
        [pane('1', '/repo'), pane('2', '/repo-other')],
        actions,
        '/repo'
      )
    ).toBe(3);
  });

  it('falls back to the first new-agent action', () => {
    expect(
      resolveControlPaneSelection(
        0,
        [pane('1', '/missing')],
        actions,
        '/repo'
      )
    ).toBe(2);
  });
});
