import type { RemotePaneActionShortcut } from './remotePaneActions.js';
import { shellQuote } from './shellQuote.js';

import {
  resolveInstalledDmuxExecutable,
  sanitizePathForInstalledDmux,
} from './pathEnvironment.js';

export function resolveDmuxExecutable(projectRoot?: string): string {
  return resolveInstalledDmuxExecutable({ projectRoot });
}

export function buildDmuxCommand(args: string[] = [], projectRoot?: string): string {
  const pathValue = sanitizePathForInstalledDmux(process.env.PATH || '', projectRoot);
  return [
    `PATH=${shellQuote(pathValue)}`,
    shellQuote(resolveDmuxExecutable(projectRoot)),
    ...args,
  ].join(' ');
}
export function buildFilesOnlyCommand(projectRoot?: string): string {
  return buildDmuxCommand(['--files-only'], projectRoot);
}

export function buildRemotePaneActionCommand(
  shortcut: RemotePaneActionShortcut,
  projectRoot?: string
): string {
  return buildDmuxCommand(['--remote-pane-action', shortcut], projectRoot);
}
