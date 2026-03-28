import { spawnSync } from 'child_process';
import { writeFileSync, chmodSync, readFileSync, existsSync, lstatSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export const REQUIRED_TMUX_UPDATE_ENV = [
  'TERM_PROGRAM',
] as const;

export const REQUIRED_TMUX_TERMINAL_OVERRIDES = [
  '*:Ms=\\E]52;c;%p2%s\\007',
] as const;

interface TmuxRuntimeCompatibilitySnapshot {
  terminalOverrides: string[];
  updateEnvironment: string[];
}

function parseTmuxArrayOptionValue(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseTmuxArrayOptionValues(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^[^[]+\[\d+\]\*?\s+(.*)$/);
      return parseTmuxArrayOptionValue(match ? match[1] : line);
    });
}

export function buildTmuxRuntimeCompatibilityCommands(
  sessionName: string,
  snapshot: TmuxRuntimeCompatibilitySnapshot
): string[][] {
  const commands: string[][] = [
    ['set-option', '-q', '-t', sessionName, 'set-clipboard', 'on'],
    ['set-option', '-q', '-t', sessionName, 'allow-passthrough', 'all'],
  ];

  for (const value of REQUIRED_TMUX_UPDATE_ENV) {
    if (!snapshot.updateEnvironment.includes(value)) {
      commands.push(['set-option', '-q', '-ag', '-t', sessionName, 'update-environment', value]);
    }
  }

  for (const value of REQUIRED_TMUX_TERMINAL_OVERRIDES) {
    if (!snapshot.terminalOverrides.includes(value)) {
      commands.push(['set-option', '-q', '-ag', '-t', sessionName, 'terminal-overrides', value]);
    }
  }

  return commands;
}

function readTmuxArrayOption(sessionName: string, optionName: string): string[] {
  try {
    const result = spawnSync(
      'tmux',
      ['show-options', '-A', '-t', sessionName, optionName],
      {
        encoding: 'utf-8',
        stdio: 'pipe',
      }
    );

    if (result.status !== 0) {
      return [];
    }

    return parseTmuxArrayOptionValues(result.stdout || '');
  } catch {
    return [];
  }
}

const OSC52_COPY_SCRIPT = `#!/bin/sh
buf=\$(cat | base64 | tr -d '\\n')
tty=\$(tmux display-message -p '#{client_tty}')
printf '\\033]52;c;%s\\007' "\$buf" > "\$tty"
`;

export function ensureOsc52CopyScript(dmuxDir = join(homedir(), '.dmux')): string {
  const scriptPath = join(dmuxDir, 'osc52-copy.sh');
  if (!existsSync(dmuxDir)) {
    mkdirSync(dmuxDir, { recursive: true });
  }
  if (existsSync(scriptPath)) {
    // Don't follow symlinks or overwrite non-regular files.
    if (!lstatSync(scriptPath).isFile()) {
      return scriptPath;
    }
    // Skip write if content already matches.
    if (readFileSync(scriptPath, 'utf-8') === OSC52_COPY_SCRIPT) {
      return scriptPath;
    }
  }
  writeFileSync(scriptPath, OSC52_COPY_SCRIPT);
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function shouldBindOsc52CopyMode(scriptPath: string): boolean {
  try {
    const result = spawnSync(
      'tmux',
      ['list-keys', '-T', 'copy-mode'],
      { encoding: 'utf-8', stdio: 'pipe' },
    );
    if (result.status !== 0) return true; // can't determine, proceed
    const binding = (result.stdout || '').split('\n').find((l) => l.includes('MouseDragEnd1Pane'));
    if (!binding) return true; // no binding, safe to set
    // Only override if it's the tmux default or already our script.
    return binding.includes('copy-selection-and-cancel') || binding.includes(scriptPath);
  } catch {
    return true;
  }
}

export function ensureTmuxRuntimeCompatibility(sessionName: string): void {
  const commands = buildTmuxRuntimeCompatibilityCommands(sessionName, {
    terminalOverrides: readTmuxArrayOption(sessionName, 'terminal-overrides'),
    updateEnvironment: readTmuxArrayOption(sessionName, 'update-environment'),
  });

  // Ensure the OSC 52 copy helper exists and bind copy-mode mouse selection to it.
  // This works reliably over SSH where tmux's built-in set-clipboard OSC 52 emission
  // and pbcopy both fail. Best effort — skip bindings if script creation fails.
  // Only override the binding if it's the tmux default (copy-selection-and-cancel) or
  // already points to the dmux script, to avoid clobbering user customizations.
  try {
    const scriptPath = ensureOsc52CopyScript();
    if (shouldBindOsc52CopyMode(scriptPath)) {
      commands.push(
        ['bind-key', '-T', 'copy-mode', 'MouseDragEnd1Pane', 'send-keys', '-X', 'copy-pipe-and-cancel', scriptPath],
        ['bind-key', '-T', 'copy-mode-vi', 'MouseDragEnd1Pane', 'send-keys', '-X', 'copy-pipe-and-cancel', scriptPath],
      );
    }
  } catch {
    // Non-fatal: clipboard copy-mode bindings will use default tmux behavior.
  }

  for (const args of commands) {
    try {
      spawnSync('tmux', args, { stdio: 'pipe' });
    } catch {
      // Best effort only. Unknown options or older tmux versions should not block startup.
    }
  }
}
