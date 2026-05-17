import { describe, expect, it } from 'vitest';
import type { DmuxPane } from '../src/types.js';
import type { ProjectActionItem } from '../src/utils/projectActions.js';
import {
  resolveControlPaneFocusSelection,
  resolveControlPaneSelection,
} from '../src/utils/controlPaneFocus.js';

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

  it('preserves a valid pane selection when focus returns to the control pane', () => {
    expect(
      resolveControlPaneSelection(
        1,
        [pane('1', '/repo'), pane('2', '/repo-other')],
        actions,
        '/repo'
      )
    ).toBe(1);
  });

  it('keeps the previously focused pane selected when empty sidebar space is clicked', () => {
    expect(
      resolveControlPaneFocusSelection(
        0,
        [pane('1', '/repo')],
        actions,
        '/repo',
        false
      )
    ).toEqual({
      selectedIndex: 0,
      selectionPending: false,
    });
  });

  it('falls back to the first new-agent action', () => {
    expect(
      resolveControlPaneSelection(
        9,
        [pane('1', '/missing')],
        actions,
        '/repo'
      )
    ).toBe(2);
  });

  it('does not mark a valid pane selection as pending on work-to-control focus return', () => {
    expect(
      resolveControlPaneFocusSelection(
        0,
        [pane('1')],
        actions,
        '/repo',
        false
      )
    ).toEqual({
      selectedIndex: 0,
      selectionPending: false,
    });
  });

  it('marks invalid selection reconciliation as pending when it changes selection', () => {
    expect(
      resolveControlPaneFocusSelection(
        9,
        [pane('1')],
        actions,
        '/repo',
        false
      )
    ).toEqual({
      selectedIndex: 2,
      selectionPending: true,
    });
  });

  it('leaves explicit control-pane navigation alone after control pane is already focused', () => {
    expect(
      resolveControlPaneFocusSelection(
        0,
        [pane('1')],
        actions,
        '/repo',
        true
      )
    ).toEqual({
      selectedIndex: 0,
      selectionPending: false,
    });
  });
});
