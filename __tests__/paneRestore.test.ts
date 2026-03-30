import { describe, expect, it } from 'vitest';
import type { DmuxPane } from '../src/types.js';
import { buildPaneRestoreCommands } from '../src/utils/paneRestore.js';
import { shellQuote } from '../src/utils/shellQuote.js';

describe('pane restoration', () => {
  it('builds quoted restore commands with a normalized prompt preview and resume command', () => {
    const prompt = `Let's debug

quoted restore behavior after reopen`;
    const expectedPreview = prompt.replace(/\s+/g, ' ').trim().substring(0, 50);
    const worktreePath = `/repo/o'clock/.dmux/worktrees/feature-codex`;
    const pane: DmuxPane = {
      id: 'dmux-1',
      slug: 'feature-codex',
      prompt,
      paneId: '%2',
      worktreePath,
      projectRoot: '/repo',
      agent: 'codex',
      permissionMode: 'bypassPermissions',
    };

    expect(buildPaneRestoreCommands(pane, '/fallback')).toEqual([
      `printf '%s\\n' ${shellQuote('# Pane restored: feature-codex')}`,
      `printf '%s\\n' ${shellQuote(`# Original prompt: ${expectedPreview}...`)}`,
      `cd ${shellQuote(worktreePath)}`,
      'codex resume --last --dangerously-bypass-approvals-and-sandbox',
    ]);
  });

  it('omits the preview banner when the prompt is blank after normalization', () => {
    const worktreePath = `/repo/o'clock/.dmux/worktrees/feature-codex`;
    const pane: DmuxPane = {
      id: 'dmux-1',
      slug: 'feature-codex',
      prompt: ' \n\t ',
      paneId: '%2',
      worktreePath,
      projectRoot: '/repo',
      agent: 'codex',
      permissionMode: 'bypassPermissions',
    };

    expect(buildPaneRestoreCommands(pane, '/fallback')).toEqual([
      `printf '%s\\n' ${shellQuote('# Pane restored: feature-codex')}`,
      `cd ${shellQuote(worktreePath)}`,
      'codex resume --last --dangerously-bypass-approvals-and-sandbox',
    ]);
  });

  it('omits the resume command when the pane has no agent', () => {
    const pane: DmuxPane = {
      id: 'dmux-1',
      slug: 'feature-codex',
      prompt: 'review restore behavior',
      paneId: '%2',
      projectRoot: '/repo',
    };

    expect(buildPaneRestoreCommands(pane, '/fallback')).toEqual([
      `printf '%s\\n' ${shellQuote('# Pane restored: feature-codex')}`,
      `printf '%s\\n' ${shellQuote('# Original prompt: review restore behavior...')}`,
      `cd ${shellQuote('/fallback')}`,
    ]);
  });
});
