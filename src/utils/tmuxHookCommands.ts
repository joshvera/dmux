import { resolveDistPath } from './runtimePaths.js';

export const DMUX_HOOK_MARKER_V2 = '# dmux-hook:v2';

type HookPayloadEventType = 'panes-changed' | 'pane-focus-changed';

/**
 * Escape a value for inclusion in a shell double-quoted string.
 */
function escapeForDoubleQuotes(value: string): string {
  return value.replace(/[\\$"`]/g, '\\$&');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function base64Encode(value: string): string {
  return Buffer.from(value, 'utf-8').toString('base64');
}

export function buildHookPayloadNotificationCommand(options: {
  eventLogPath: string;
  eventType: HookPayloadEventType;
  pid: number;
  sessionName: string;
  activePaneIdFormat?: string;
}): string {
  const writerScriptPath = resolveDistPath('utils', 'tmuxHookPayloadWriter.js');
  const args = [
    'node',
    shellQuote(writerScriptPath),
    '--event-log-b64',
    base64Encode(options.eventLogPath),
    '--event-type',
    options.eventType,
    '--pid',
    String(options.pid),
    '--session-b64',
    base64Encode(options.sessionName),
  ];

  if (options.activePaneIdFormat) {
    args.push('--active-pane-id', shellQuote(options.activePaneIdFormat));
  }

  return [
    args.join(' '),
    '>/dev/null 2>&1;',
    `kill -USR2 ${options.pid} 2>/dev/null || true ${DMUX_HOOK_MARKER_V2}`,
  ].join(' ');
}

export function buildHookPayloadRunShellCommand(options: {
  eventLogPath: string;
  eventType: HookPayloadEventType;
  pid: number;
  sessionName: string;
}): string {
  return `run-shell "${escapeForDoubleQuotes(buildHookPayloadNotificationCommand(options))}"`;
}

function buildLegacyNotificationCommand(pid: number): string {
  return `kill -USR2 ${pid} 2>/dev/null || true # dmux-hook`;
}

/**
 * Builds the pane-exited hook command used by dmux.
 *
 * It performs two actions:
 * 1) Best-effort control-pane recovery if the control pane was killed.
 * 2) Notifies the current dmux process via SIGUSR2 for normal pane sync.
 */
export function buildPaneExitedHookCommand(pid: number): string {
  const recoveryScriptPath = resolveDistPath('utils', 'controlPaneRecovery.js');
  const escapedScriptPath = escapeForDoubleQuotes(recoveryScriptPath);
  return `run-shell "DMUX_RECOVERY_EXITED_PANE=#{hook_pane} node \\"${escapedScriptPath}\\" >/dev/null 2>&1; ${buildLegacyNotificationCommand(pid)}"`;
}

/**
 * Same as buildPaneExitedHookCommand, but with an explicit session name.
 * This avoids relying on hook format variables that may vary by tmux version.
 */
export function buildPaneExitedHookCommandForSession(
  pid: number,
  sessionName: string,
  eventLogPath?: string
): string {
  const recoveryScriptPath = resolveDistPath('utils', 'controlPaneRecovery.js');
  const escapedScriptPath = escapeForDoubleQuotes(recoveryScriptPath);
  const encodedSessionName = base64Encode(sessionName);
  const notificationCommand = eventLogPath
    ? buildHookPayloadNotificationCommand({
      eventLogPath,
      eventType: 'panes-changed',
      pid,
      sessionName,
    })
    : buildLegacyNotificationCommand(pid);

  return `run-shell "DMUX_RECOVERY_SESSION_B64=${encodedSessionName} DMUX_RECOVERY_EXITED_PANE=#{hook_pane} node \\"${escapedScriptPath}\\" >/dev/null 2>&1; ${escapeForDoubleQuotes(notificationCommand)}"`;
}

/**
 * Builds an after-select-pane hook that copies the focused pane's cached border
 * style onto the session immediately. This stays inside tmux so focus changes
 * do not need to wait on a shell subprocess before the active border updates.
 */
export function buildPaneFocusHookCommandForSession(
  sessionName: string,
  pid?: number,
  eventLogPath?: string
): string {
  const escapedSessionName = escapeForDoubleQuotes(sessionName);
  let notifyController = '';
  if (typeof pid === 'number') {
    const notificationCommand = eventLogPath
      ? buildHookPayloadNotificationCommand({
        eventLogPath,
        eventType: 'pane-focus-changed',
        pid,
        sessionName,
        activePaneIdFormat: '#{pane_id}',
      })
      : buildLegacyNotificationCommand(pid);
    notifyController = `; run-shell -b "${escapeForDoubleQuotes(notificationCommand)}"`;
  }

  return `if-shell -F "#{!=:#{@dmux_active_border_style},}" "set-option -q -F -t \\"${escapedSessionName}\\" pane-active-border-style \\"#{@dmux_active_border_style}\\""${notifyController}`;
}
