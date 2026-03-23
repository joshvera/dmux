import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PaneAction, type PaneMenuAction } from '../src/actions/types.js';
import {
  FocusActionSheetPopupApp,
  getOrderedFocusActionSheetActions,
} from '../src/components/popups/focusActionSheetPopup.js';

const tempDirs: string[] = [];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('FocusActionSheetPopupApp', () => {
  it('groups actions for mobile readability and selects by shortcut', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmux-focus-action-sheet-'));
    tempDirs.push(tempDir);
    const resultFile = path.join(tempDir, 'result.json');

    const actions: PaneMenuAction[] = [
      {
        id: PaneAction.ATTACH_AGENT,
        label: 'Add Agent to Worktree',
        description: 'Add another agent to this worktree',
        shortcut: 'a',
      },
      {
        id: PaneAction.OPEN_IN_EDITOR,
        label: 'Open in Editor',
        description: 'Open worktree in external editor',
      },
      {
        id: 'toggle_visibility',
        label: 'Hide Pane',
        description: 'Hide this pane from the active window',
        shortcut: 'h',
      },
    ];

    const { stdin, lastFrame, unmount } = render(
      <FocusActionSheetPopupApp
        resultFile={resultFile}
        paneName="Agent One"
        actions={actions}
      />
    );

    const output = stripAnsi(lastFrame() ?? '');
    expect(output).toContain('Worktree');
    expect(output).toContain('Utility');
    expect(output).toContain('Visibility');
    expect(output).toContain('Add Agent to Worktree');
    expect(output).toContain('Open in Editor');
    expect(output).toContain('Hide Pane');

    await sleep(20);
    stdin.write('h');
    await sleep(20);

    expect(JSON.parse(fs.readFileSync(resultFile, 'utf8'))).toEqual({
      success: true,
      data: 'toggle_visibility',
    });

    unmount();
  });

  it.each([
    ['A', 'open_terminal_in_worktree', 'Add Terminal to Worktree'],
    ['S', 'set_source', '[DEV] Toggle Source (Pane/Root)'],
    ['P', 'show-all', 'Show All Panes'],
  ])('routes shortcut %s to the displayed %s action', async (shortcut, actionId, label) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmux-focus-action-sheet-'));
    tempDirs.push(tempDir);
    const resultFile = path.join(tempDir, `result-${actionId}.json`);

    const actions: PaneMenuAction[] = [
      {
        id: 'show-all',
        label: 'Show All Panes',
        description: 'Show panes from every project',
        shortcut: 'P',
      },
      {
        id: PaneAction.SET_SOURCE,
        label: '[DEV] Toggle Source (Pane/Root)',
        description: 'Toggle between this pane as source and project root',
        shortcut: 'S',
      },
      {
        id: PaneAction.OPEN_TERMINAL_IN_WORKTREE,
        label: 'Add Terminal to Worktree',
        description: 'Open a new shell pane in this worktree',
        shortcut: 'A',
      },
    ];

    const { stdin, lastFrame, unmount } = render(
      <FocusActionSheetPopupApp
        resultFile={resultFile}
        paneName="Agent One"
        actions={actions}
      />
    );

    expect(stripAnsi(lastFrame() ?? '')).toContain(label);

    await sleep(20);
    stdin.write(shortcut);
    await sleep(20);

    expect(JSON.parse(fs.readFileSync(resultFile, 'utf8'))).toEqual({
      success: true,
      data: actionId,
    });

    unmount();
  });

  it('maps Enter to the displayed Show All Panes row instead of a utility action', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmux-focus-action-sheet-'));
    tempDirs.push(tempDir);
    const resultFile = path.join(tempDir, 'result.json');

    const actions: PaneMenuAction[] = [
      {
        id: 'show-all',
        label: 'Show All Panes',
        description: 'Show panes from every project',
        shortcut: 'P',
      },
      {
        id: PaneAction.RENAME,
        label: 'Rename',
        description: 'Rename this pane',
      },
    ];

    const { stdin, lastFrame, unmount } = render(
      <FocusActionSheetPopupApp
        resultFile={resultFile}
        paneName="Agent One"
        actions={actions}
        initialSelectedIndex={1}
      />
    );

    const orderedActions = getOrderedFocusActionSheetActions(actions);
    expect(orderedActions.map((action) => action.id)).toEqual([
      PaneAction.RENAME,
      'show-all',
    ]);

    expect(stripAnsi(lastFrame() ?? '')).toContain('> Show All Panes');

    await sleep(20);
    stdin.write('\r');
    await vi.waitFor(() => {
      expect(JSON.parse(fs.readFileSync(resultFile, 'utf8'))).toEqual({
        success: true,
        data: 'show-all',
      });
    });

    unmount();
  });

  it('maps Enter to the displayed Rename row instead of a visibility action', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmux-focus-action-sheet-'));
    tempDirs.push(tempDir);
    const resultFile = path.join(tempDir, 'result.json');

    const actions: PaneMenuAction[] = [
      {
        id: 'show-all',
        label: 'Show All Panes',
        description: 'Show panes from every project',
        shortcut: 'P',
      },
      {
        id: PaneAction.RENAME,
        label: 'Rename',
        description: 'Rename this pane',
      },
    ];

    const { stdin, lastFrame, unmount } = render(
      <FocusActionSheetPopupApp
        resultFile={resultFile}
        paneName="Agent One"
        actions={actions}
        initialSelectedIndex={0}
      />
    );

    expect(stripAnsi(lastFrame() ?? '')).toContain('> Rename');

    await sleep(20);
    stdin.write('\r');
    await vi.waitFor(() => {
      expect(JSON.parse(fs.readFileSync(resultFile, 'utf8'))).toEqual({
        success: true,
        data: 'rename',
      });
    });

    unmount();
  });
});
