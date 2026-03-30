import type { DmuxPane } from '../types.js';
import { buildAgentResumeOrLaunchCommand } from './agentLaunch.js';
import { shellQuote } from './shellQuote.js';

const PROMPT_PREVIEW_LENGTH = 50;

export type PaneRestorePlanInput = Pick<
  DmuxPane,
  'slug' | 'prompt' | 'worktreePath' | 'agent' | 'permissionMode'
>;

export function getPromptPreview(prompt?: string): string {
  const normalizedPrompt = (prompt || '').replace(/\s+/g, ' ').trim();
  return normalizedPrompt
    ? normalizedPrompt.substring(0, PROMPT_PREVIEW_LENGTH)
    : '';
}

export function buildPaneRestoreCommands(
  pane: PaneRestorePlanInput,
  fallbackCwd: string = process.cwd()
): string[] {
  const commands = [
    `printf '%s\\n' ${shellQuote(`# Pane restored: ${pane.slug}`)}`,
  ];
  const promptPreview = getPromptPreview(pane.prompt);
  const worktreePath = pane.worktreePath || fallbackCwd;

  if (promptPreview) {
    commands.push(
      `printf '%s\\n' ${shellQuote(`# Original prompt: ${promptPreview}...`)}`
    );
  }

  commands.push(`cd ${shellQuote(worktreePath)}`);

  if (pane.agent) {
    commands.push(
      buildAgentResumeOrLaunchCommand(pane.agent, pane.permissionMode)
    );
  }

  return commands;
}
