import { execSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { performance } from 'perf_hooks';

export type DmuxPerfLane = 'server-observed' | 'client-observed';
export type DmuxPerfCommandKind =
  | 'buffer'
  | 'capture-pane'
  | 'display-message'
  | 'list-panes'
  | 'list-windows'
  | 'pane-lifecycle'
  | 'refresh-client'
  | 'resize'
  | 'select-layout'
  | 'select-pane'
  | 'send-keys'
  | 'set-option'
  | 'show-option'
  | 'other';
export type DmuxPerfCommandSource = 'tmux-service' | 'perf-runtime' | 'unknown';
export type DmuxPerfCommandTargetKind =
  | 'buffer'
  | 'client'
  | 'global'
  | 'pane'
  | 'server'
  | 'session'
  | 'window'
  | 'unknown';
export type DmuxPerfCommandOperation =
  | 'buffer'
  | 'client-key-table'
  | 'client-refresh'
  | 'client-tty'
  | 'current-pane'
  | 'current-window'
  | 'layout'
  | 'pane-content'
  | 'pane-count'
  | 'pane-current-command'
  | 'pane-exists'
  | 'pane-info'
  | 'pane-lifecycle'
  | 'pane-resize'
  | 'pane-select'
  | 'pane-send-keys'
  | 'pane-title'
  | 'pane-window'
  | 'session-pane-list'
  | 'status-height'
  | 'terminal-dimensions'
  | 'tmux-option'
  | 'window-dimensions'
  | 'window-lifecycle'
  | 'window-option'
  | 'window-pane-list'
  | 'zoom';
export type DmuxPerfCurrentPaneContext =
  | 'startup-control'
  | 'pane-runner'
  | 'worktree-actions'
  | 'input-handling'
  | 'spacer-manager'
  | 'dmux-fallback'
  | 'unknown';
export type DmuxPerfPaneOptionKind =
  | 'dmux-title-prefix'
  | 'dmux-title-label'
  | 'dmux-active-border-style'
  | 'dmux-attention'
  | 'dmux-welcome-theme'
  | 'window-style'
  | 'other';
export type DmuxPerfErrorKind =
  | 'exit'
  | 'invalid-command'
  | 'missing-target'
  | 'not-found'
  | 'permission-denied'
  | 'timeout'
  | 'unknown';

export interface DmuxPerfMetadata {
  sessionName?: string;
  projectRoot?: string;
  projectRootHash?: string;
  instanceLabel?: string;
  transport?: string;
  terminalApp?: string;
  paneCount?: number;
  workerCount?: number;
  tmuxServerPid?: number;
}

export interface DmuxPerfEventFields {
  lane?: DmuxPerfLane;
  durationMs?: number;
  count?: number;
  bytes?: number;
  paneId?: string;
  tmuxPaneId?: string;
  commandKind?: DmuxPerfCommandKind;
  operation?: DmuxPerfCommandOperation;
  source?: DmuxPerfCommandSource;
  targetKind?: DmuxPerfCommandTargetKind;
  errorKind?: DmuxPerfErrorKind;
  sync?: boolean;
  success?: boolean;
  metadata?: Record<string, unknown>;
}

export type DmuxPerfInputSurface = 'main' | 'hooks-prompt' | 'unknown';
export type DmuxPerfKeyKind = 'printable' | 'enter' | 'escape' | 'arrow' | 'ctrl' | 'function' | 'unknown';
export type DmuxPerfInputClassification = 'handled' | 'ignored' | 'noop' | 'unhandled';

export interface DmuxPerfInputStartOptions {
  surface?: DmuxPerfInputSurface;
  keyKind?: DmuxPerfKeyKind;
}

export interface DmuxPerfInputClassificationFields {
  classification: DmuxPerfInputClassification;
  reason?: string;
  actionKind?: string;
  visibleStateChanged?: boolean;
}

export interface DmuxPerfInputSpan {
  classify(fields: DmuxPerfInputClassificationFields): void;
  armKeyToRender(): void;
  finish(): void;
}

export interface DmuxPerfJsonEvent extends DmuxPerfEventFields {
  timestamp: string;
  monotonicMs: number;
  runId: string;
  pid: number;
  event: string;
  sessionName?: string;
  projectRootHash?: string;
  instanceLabel?: string;
  transport?: string;
}

interface WritableLike {
  write(chunk: string | Uint8Array, callback?: (error?: Error | null) => void): boolean;
  write(
    chunk: string | Uint8Array,
    encoding?: BufferEncoding,
    callback?: (error?: Error | null) => void
  ): boolean;
}

interface ProcessStats {
  pid: number;
  cpuPercent?: number;
  rssKb?: number;
}

let cachedRunId: string | undefined;
let cachedLogPath: string | undefined;
let metadata: DmuxPerfMetadata = {};
let metadataSignature = '';
let runtimeMonitorStop: (() => void) | undefined;
const pendingInputSpans: PendingInputSpan[] = [];
const patchedWritables = new WeakMap<object, () => void>();
let nextInputSequence = 0;

interface PendingInputSpan {
  inputId: string;
  startedAt: number;
  surface: DmuxPerfInputSurface;
  keyKind: DmuxPerfKeyKind;
  classification?: DmuxPerfInputClassification;
  reason?: string;
  actionKind?: string;
  visibleStateChanged?: boolean;
  armed: boolean;
  queuedForRender: boolean;
  inputRecorded: boolean;
  finished: boolean;
}

export function isDmuxPerfEnabled(): boolean {
  return process.env.DMUX_PERF === '1';
}

export function getDmuxPerfRunId(): string {
  if (process.env.DMUX_PERF_RUN_ID) {
    cachedRunId = process.env.DMUX_PERF_RUN_ID;
    return cachedRunId;
  }

  if (!cachedRunId) {
    const timestamp = new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-').replace('Z', '');
    cachedRunId = `${timestamp}-${randomUUID().slice(0, 8)}`;
    process.env.DMUX_PERF_RUN_ID = cachedRunId;
  }

  return cachedRunId;
}

export function getDmuxPerfDir(): string {
  return process.env.DMUX_PERF_DIR || path.join(os.homedir(), '.dmux', 'perf');
}

export function hashDmuxPerfProjectRoot(projectRoot: string): string {
  return createHash('sha1').update(path.resolve(projectRoot)).digest('hex').slice(0, 12);
}

export function inferDmuxPerfTransport(): string {
  if (process.env.DMUX_PERF_TRANSPORT) {
    return process.env.DMUX_PERF_TRANSPORT;
  }

  const envKeys = Object.keys(process.env);
  if (envKeys.some((key) => key === 'ET' || key.startsWith('ET_') || key.startsWith('LC_ET'))) {
    return 'eternal-terminal';
  }
  if (process.env.MOSH_IP || process.env.MOSH_KEY) {
    return 'mosh';
  }
  if (process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY) {
    return 'ssh';
  }
  if (process.env.TMUX) {
    return 'local-tmux';
  }

  return 'local';
}

export function classifyTmuxCommand(command: string): DmuxPerfCommandKind {
  if (/\bcapture-pane\b/.test(command)) return 'capture-pane';
  if (/\blist-panes\b/.test(command)) return 'list-panes';
  if (/\blist-windows\b/.test(command)) return 'list-windows';
  if (/\bdisplay-message\b/.test(command)) return 'display-message';
  if (/\bsend-keys\b/.test(command)) return 'send-keys';
  if (/\bselect-pane\b/.test(command)) return 'select-pane';
  if (/\bselect-layout\b/.test(command)) return 'select-layout';
  if (/\b(?:resize-pane|resize-window)\b/.test(command)) return 'resize';
  if (/\b(?:split-window|join-pane|kill-pane|kill-window)\b/.test(command)) return 'pane-lifecycle';
  if (/\b(?:set-buffer|load-buffer|paste-buffer|delete-buffer)\b/.test(command)) return 'buffer';
  if (/\brefresh-client\b/.test(command)) return 'refresh-client';
  if (/\b(?:set-option|set-window-option|set)\b/.test(command)) return 'set-option';
  if (/\b(?:show-options|show)\b/.test(command)) return 'show-option';
  return 'other';
}

export function classifyTmuxCommandTarget(command: string): DmuxPerfCommandTargetKind {
  const commandKind = classifyTmuxCommand(command);
  if (commandKind === 'buffer') return 'buffer';
  if (commandKind === 'refresh-client') return 'client';
  if (commandKind === 'list-windows') return 'session';
  if (commandKind === 'select-layout') return 'window';
  if (commandKind === 'resize' && /\bresize-window\b/.test(command)) return 'window';
  if (commandKind === 'pane-lifecycle' && /\bkill-window\b/.test(command)) return 'window';
  if (commandKind === 'set-option' && /\s-g\b/.test(command)) return 'global';
  if (
    commandKind === 'show-option'
    && /\bshow(?:-options)?\s+(?:[^|;&]*\s)?-g(?:v)?\b/.test(command)
  ) {
    return 'global';
  }
  if (/\b(?:attach-session|new-session|switch-client|has-session)\b/.test(command)) return 'session';
  if (/\b(?:display-message|list-panes)\b/.test(command) && !/\s-t\s+/.test(command)) return 'server';
  if (/\s-t\s+['"]?%/.test(command)) return 'pane';
  if (/\s-t\s+['"]?@/.test(command)) return 'window';
  if (/\s-t\s+/.test(command)) return 'unknown';
  if (
    commandKind === 'capture-pane'
    || commandKind === 'send-keys'
    || commandKind === 'select-pane'
    || commandKind === 'pane-lifecycle'
  ) {
    return 'pane';
  }
  return 'server';
}

export function classifyDmuxPerfErrorKind(error: unknown): DmuxPerfErrorKind {
  const message = String(error).toLowerCase();
  const errorWithCode = error as {
    code?: unknown;
    status?: unknown;
    signal?: unknown;
    killed?: unknown;
  };
  if (
    message.includes('timeout')
    || errorWithCode.code === 'ETIMEDOUT'
    || errorWithCode.killed === true
  ) {
    return 'timeout';
  }
  if (
    message.includes('tmux not found')
    || message.includes('command not found')
    || errorWithCode.code === 'ENOENT'
  ) {
    return 'not-found';
  }
  if (message.includes('permission denied') || errorWithCode.code === 'EACCES') {
    return 'permission-denied';
  }
  if (
    message.includes("can't find")
    || message.includes('no such session')
    || message.includes('no session found')
  ) {
    return 'missing-target';
  }
  if (message.includes('invalid')) {
    return 'invalid-command';
  }
  if (typeof errorWithCode.code === 'number' || typeof errorWithCode.status === 'number') {
    return 'exit';
  }
  return 'unknown';
}

export function isDmuxPerfCurrentPaneContext(
  value: unknown
): value is DmuxPerfCurrentPaneContext {
  switch (value) {
    case 'startup-control':
    case 'pane-runner':
    case 'worktree-actions':
    case 'input-handling':
    case 'spacer-manager':
    case 'dmux-fallback':
    case 'unknown':
      return true;
    default:
      return false;
  }
}

export function normalizeDmuxPerfCurrentPaneContext(
  value: unknown
): DmuxPerfCurrentPaneContext {
  return isDmuxPerfCurrentPaneContext(value) ? value : 'unknown';
}

export function classifyDmuxPerfPaneOption(option: string): DmuxPerfPaneOptionKind {
  switch (option) {
    case '@dmux_title_prefix':
      return 'dmux-title-prefix';
    case '@dmux_title_label':
      return 'dmux-title-label';
    case '@dmux_active_border_style':
      return 'dmux-active-border-style';
    case '@dmux_attention':
      return 'dmux-attention';
    case '@dmux_welcome_theme':
      return 'dmux-welcome-theme';
    case 'window-style':
      return 'window-style';
    default:
      return 'other';
  }
}

export function isDmuxPerfPaneOptionKind(
  value: unknown
): value is DmuxPerfPaneOptionKind {
  switch (value) {
    case 'dmux-title-prefix':
    case 'dmux-title-label':
    case 'dmux-active-border-style':
    case 'dmux-attention':
    case 'dmux-welcome-theme':
    case 'window-style':
    case 'other':
      return true;
    default:
      return false;
  }
}

export function normalizeDmuxPerfPaneOptionKind(
  value: unknown
): DmuxPerfPaneOptionKind {
  return isDmuxPerfPaneOptionKind(value) ? value : 'other';
}

export function configureDmuxPerfMetadata(nextMetadata: DmuxPerfMetadata): void {
  if (!isDmuxPerfEnabled()) {
    return;
  }

  const projectRootHash = nextMetadata.projectRoot
    ? hashDmuxPerfProjectRoot(nextMetadata.projectRoot)
    : nextMetadata.projectRootHash;

  metadata = {
    ...metadata,
    ...nextMetadata,
    ...(projectRootHash ? { projectRootHash } : {}),
    instanceLabel: nextMetadata.instanceLabel || process.env.DMUX_PERF_INSTANCE || metadata.instanceLabel,
    transport: nextMetadata.transport || inferDmuxPerfTransport(),
    terminalApp: nextMetadata.terminalApp || inferTerminalApp(),
    tmuxServerPid: nextMetadata.tmuxServerPid || metadata.tmuxServerPid || readTmuxServerPid(),
  };

  const signature = JSON.stringify(metadata);
  if (signature !== metadataSignature) {
    metadataSignature = signature;
    recordDmuxPerfEvent('perf.metadata', { metadata: { ...metadata } });
  }
}

export function recordDmuxPerfEvent(event: string, fields: DmuxPerfEventFields = {}): void {
  if (!isDmuxPerfEnabled()) {
    return;
  }

  writePerfEvent(event, fields, getDmuxPerfLogPath());
}

export function timeDmuxPerfSync<T>(
  event: string,
  fields: DmuxPerfEventFields,
  operation: () => T
): T {
  if (!isDmuxPerfEnabled()) {
    return operation();
  }

  const startedAt = performance.now();
  try {
    const result = operation();
    recordDmuxPerfEvent(event, buildTimingEventFields(fields, startedAt, true));
    return result;
  } catch (error) {
    recordDmuxPerfEvent(event, buildTimingEventFields(fields, startedAt, false, error));
    throw error;
  }
}

export async function timeDmuxPerfAsync<T>(
  event: string,
  fields: DmuxPerfEventFields,
  operation: () => Promise<T>
): Promise<T> {
  if (!isDmuxPerfEnabled()) {
    return operation();
  }

  const startedAt = performance.now();
  try {
    const result = await operation();
    recordDmuxPerfEvent(event, buildTimingEventFields(fields, startedAt, true));
    return result;
  } catch (error) {
    recordDmuxPerfEvent(event, buildTimingEventFields(fields, startedAt, false, error));
    throw error;
  }
}

export function recordDmuxPerfInput(options: DmuxPerfInputStartOptions = {}): DmuxPerfInputSpan {
  if (!isDmuxPerfEnabled()) {
    return noopInputSpan;
  }

  const span: PendingInputSpan = {
    inputId: `input-${process.pid}-${++nextInputSequence}`,
    startedAt: performance.now(),
    surface: options.surface || 'unknown',
    keyKind: options.keyKind || 'unknown',
    armed: false,
    queuedForRender: false,
    inputRecorded: false,
    finished: false,
  };

  const queueIfEligible = () => {
    if (
      span.armed
      && !span.queuedForRender
      && span.classification === 'handled'
      && span.visibleStateChanged === true
    ) {
      span.queuedForRender = true;
      pendingInputSpans.push(span);
    }
  };

  return {
    classify(fields: DmuxPerfInputClassificationFields): void {
      if (span.finished) {
        return;
      }

      span.classification = fields.classification;
      span.reason = fields.reason;
      span.actionKind = fields.actionKind;
      span.visibleStateChanged = fields.visibleStateChanged === true;
      recordInputSpan(span);
      queueIfEligible();
    },

    armKeyToRender(): void {
      if (span.finished) {
        return;
      }

      span.armed = true;
      queueIfEligible();
    },

    finish(): void {
      if (span.finished) {
        return;
      }

      span.finished = true;
      if (!span.classification) {
        span.classification = 'unhandled';
        span.visibleStateChanged = false;
      }
      recordInputSpan(span);
    },
  };
}

function recordInputSpan(span: PendingInputSpan): void {
  if (span.inputRecorded) {
    return;
  }

  span.inputRecorded = true;
  recordDmuxPerfEvent('ui.input', {
    count: 1,
    metadata: buildInputMetadata(span),
  });
}

export function recordDmuxPerfRender(): void {
  if (!isDmuxPerfEnabled()) {
    return;
  }

  const now = performance.now();
  recordDmuxPerfEvent('ui.render', { count: 1 });

  while (pendingInputSpans.length > 0) {
    const span = pendingInputSpans.shift();
    if (span !== undefined) {
      recordDmuxPerfEvent('ui.key_to_render', {
        durationMs: now - span.startedAt,
        count: 1,
        metadata: buildInputMetadata(span),
      });
    }
  }
}

export function normalizeDmuxPerfKeyKind(
  input: string,
  key: Record<string, unknown> = {}
): DmuxPerfKeyKind {
  if (key.return) return 'enter';
  if (key.escape) return 'escape';
  if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) return 'arrow';
  if (key.ctrl) return 'ctrl';
  if (Object.keys(key).some((name) => /^f\d+$/i.test(name) && key[name])) return 'function';
  if (input.length > 0) return 'printable';
  return 'unknown';
}

export function patchDmuxPerfWritable(writable: WritableLike | undefined): () => void {
  if (!isDmuxPerfEnabled() || !writable) {
    return () => {};
  }

  const existingUnpatch = patchedWritables.get(writable);
  if (existingUnpatch) {
    return existingUnpatch;
  }

  const originalWrite = writable.write.bind(writable) as WritableLike['write'];
  writable.write = ((
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void
  ) => {
    const bytes = byteLength(chunk);
    if (bytes > 0) {
      recordDmuxPerfEvent('ui.stdout_write', {
        bytes,
        metadata: { approximate: true },
      });
    }
    if (typeof encodingOrCallback === 'function') {
      return originalWrite(chunk, encodingOrCallback);
    }
    return originalWrite(chunk, encodingOrCallback, callback);
  }) as WritableLike['write'];

  const unpatch = () => {
    writable.write = originalWrite;
    patchedWritables.delete(writable);
  };
  patchedWritables.set(writable, unpatch);
  return unpatch;
}

export function startDmuxPerfRuntimeMonitor(): () => void {
  if (!isDmuxPerfEnabled()) {
    return () => {};
  }

  if (runtimeMonitorStop) {
    return runtimeMonitorStop;
  }

  const eventLoopIntervalMs = 1000;
  let expectedAt = performance.now() + eventLoopIntervalMs;
  const eventLoopTimer = setInterval(() => {
    const now = performance.now();
    const lagMs = Math.max(0, now - expectedAt);
    expectedAt = now + eventLoopIntervalMs;
    recordDmuxPerfEvent('runtime.event_loop_lag', { durationMs: lagMs });
  }, eventLoopIntervalMs);

  const hostTimer = setInterval(() => {
    recordDmuxPerfEvent('runtime.host_snapshot', {
      metadata: buildHostSnapshot(),
    });
  }, 5000);

  eventLoopTimer.unref();
  hostTimer.unref();

  runtimeMonitorStop = () => {
    clearInterval(eventLoopTimer);
    clearInterval(hostTimer);
    runtimeMonitorStop = undefined;
  };

  return runtimeMonitorStop;
}

export function writeDmuxPerfClientMarker(options: {
  runId: string;
  marker: string;
  instanceLabel?: string;
  transport?: string;
  metadata?: Record<string, unknown>;
}): string {
  const filePath = path.join(
    getDmuxPerfDir(),
    `dmux-client-${sanitizePathSegment(options.runId)}-${Date.now()}.jsonl`
  );

  writePerfEvent(
    'client.marker',
    {
      lane: 'client-observed',
      count: 1,
      metadata: {
        marker: options.marker,
        ...options.metadata,
      },
    },
    filePath,
    {
      runId: options.runId,
      instanceLabel: options.instanceLabel,
      transport: options.transport || inferDmuxPerfTransport(),
    }
  );

  return filePath;
}

export function writeDmuxPerfTransportRttEvent(options: {
  runId: string;
  durationMs: number;
  sequence: number;
  instanceLabel?: string;
  transport?: string;
  source?: 'eternal-terminal';
  parser?: 'keepalive-log';
  timestamp?: string;
}): string {
  if (!Number.isFinite(options.durationMs) || options.durationMs <= 0) {
    throw new Error('transport RTT duration must be a positive finite number');
  }

  const filePath = path.join(
    getDmuxPerfDir(),
    `dmux-client-${sanitizePathSegment(options.runId)}-${Date.now()}.jsonl`
  );

  writePerfEvent(
    'client.transport_rtt',
    {
      lane: 'client-observed',
      durationMs: options.durationMs,
      count: 1,
      metadata: {
        source: options.source || 'eternal-terminal',
        parser: options.parser || 'keepalive-log',
        sequence: options.sequence,
      },
    },
    filePath,
    {
      runId: options.runId,
      instanceLabel: options.instanceLabel,
      transport: options.transport || inferDmuxPerfTransport(),
      ...(options.timestamp ? { timestamp: options.timestamp } : {}),
    }
  );

  return filePath;
}

export function resetDmuxPerfForTests(): void {
  cachedRunId = undefined;
  cachedLogPath = undefined;
  metadata = {};
  metadataSignature = '';
  pendingInputSpans.length = 0;
  nextInputSequence = 0;
  if (runtimeMonitorStop) {
    runtimeMonitorStop();
  }
}

const noopInputSpan: DmuxPerfInputSpan = {
  classify(): void {},
  armKeyToRender(): void {},
  finish(): void {},
};

function writePerfEvent(
  event: string,
  fields: DmuxPerfEventFields,
  filePath: string,
  overrides: Partial<DmuxPerfJsonEvent> = {}
): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const payload: DmuxPerfJsonEvent = {
      timestamp: overrides.timestamp ?? new Date().toISOString(),
      monotonicMs: overrides.monotonicMs ?? performance.now(),
      runId: overrides.runId || getDmuxPerfRunId(),
      pid: process.pid,
      event,
      lane: fields.lane || 'server-observed',
      sessionName: overrides.sessionName || metadata.sessionName,
      projectRootHash: overrides.projectRootHash || metadata.projectRootHash,
      instanceLabel: overrides.instanceLabel || metadata.instanceLabel || process.env.DMUX_PERF_INSTANCE,
      transport: overrides.transport || metadata.transport || inferDmuxPerfTransport(),
      ...fields,
    };

    fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
  } catch {
    // Perf logging must never affect dmux behavior.
  }
}

function buildTimingEventFields(
  fields: DmuxPerfEventFields,
  startedAt: number,
  success: boolean,
  error?: unknown
): DmuxPerfEventFields {
  return {
    ...fields,
    durationMs: performance.now() - startedAt,
    success,
    ...(success ? {} : { errorKind: fields.errorKind || classifyDmuxPerfErrorKind(error) }),
  };
}

function buildInputMetadata(span: PendingInputSpan): Record<string, unknown> {
  return {
    inputId: span.inputId,
    surface: span.surface,
    keyKind: span.keyKind,
    classification: span.classification || 'unhandled',
    ...(span.reason ? { reason: span.reason } : {}),
    ...(span.actionKind ? { actionKind: span.actionKind } : {}),
    visibleStateChanged: span.visibleStateChanged === true,
  };
}

function getDmuxPerfLogPath(): string {
  if (!cachedLogPath) {
    cachedLogPath = path.join(
      getDmuxPerfDir(),
      `dmux-${sanitizePathSegment(getDmuxPerfRunId())}-${process.pid}.jsonl`
    );
  }
  return cachedLogPath;
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function inferTerminalApp(): string | undefined {
  return process.env.DMUX_PERF_TERMINAL
    || process.env.TERM_PROGRAM
    || process.env.LC_TERMINAL
    || process.env.TERMINAL_EMULATOR
    || process.env.TERM;
}

function readTmuxServerPid(): number | undefined {
  if (!process.env.TMUX) {
    return undefined;
  }

  try {
    const output = execSync("tmux display-message -p '#{pid}'", {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const pid = Number.parseInt(output, 10);
    return Number.isFinite(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

function buildHostSnapshot(): Record<string, unknown> {
  const memory = process.memoryUsage();
  const cpu = process.cpuUsage();
  const tmuxServerStats = metadata.tmuxServerPid
    ? readProcessStats(metadata.tmuxServerPid)
    : undefined;

  return {
    process: {
      pid: process.pid,
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
      external: memory.external,
      cpuUserMicros: cpu.user,
      cpuSystemMicros: cpu.system,
    },
    host: {
      loadavg: os.loadavg(),
      freemem: os.freemem(),
      totalmem: os.totalmem(),
    },
    tmuxServer: tmuxServerStats,
  };
}

function readProcessStats(pid: number): ProcessStats | undefined {
  try {
    const output = execSync(`ps -p ${pid} -o pid=,pcpu=,rss=`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const [pidText, cpuText, rssText] = output.split(/\s+/);
    return {
      pid: Number.parseInt(pidText, 10),
      cpuPercent: Number.parseFloat(cpuText),
      rssKb: Number.parseInt(rssText, 10),
    };
  } catch {
    return undefined;
  }
}

function byteLength(chunk: unknown): number {
  if (typeof chunk === 'string') {
    return Buffer.byteLength(chunk);
  }
  if (chunk instanceof Uint8Array) {
    return chunk.byteLength;
  }
  return 0;
}
