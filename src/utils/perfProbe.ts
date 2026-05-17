import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { performance } from 'perf_hooks';
import {
  getDmuxPerfDir,
  inferDmuxPerfTransport,
  type DmuxPerfJsonEvent,
} from './perf.js';

const DSR_REQUEST = '\u001b[6n';
const DSR_RESPONSE_PATTERN = /\u001b\[\d+;\d+R/;
const MAX_DSR_BUFFER_LENGTH = 128;

export type TerminalRoundtripResult = 'success' | 'timeout' | 'error';

export interface TerminalRoundtripEventOptions {
  runId: string;
  instanceLabel?: string;
  transport?: string;
  iteration: number;
  durationMs: number;
  result: TerminalRoundtripResult;
  filePath?: string;
  metadata?: Record<string, unknown>;
}

export interface TerminalRoundtripProbeOptions {
  runId: string;
  instanceLabel?: string;
  transport?: string;
  iterations: number;
  timeoutMs: number;
  input?: TerminalInput;
  output?: TerminalOutput;
  signalTarget?: SignalTarget;
  filePath?: string;
}

export interface TerminalRoundtripProbeRun {
  filePath: string;
  results: TerminalDsrRoundtripResult[];
  supported: boolean;
}

export interface ClientInputWindowEventOptions {
  runId: string;
  instanceLabel?: string;
  transport?: string;
  label: string;
  startedAt: Date;
  stoppedAt: Date;
  preProbe?: TerminalRoundtripProbeRun;
  postProbe?: TerminalRoundtripProbeRun;
  perfDir?: string;
  filePath?: string;
}

export interface ClientInputWindowSummary {
  handledVisibleInputCount: number;
  matchedKeyToRenderCount: number;
  renderCount: number;
}

export interface TerminalDsrRoundtripOptions {
  input?: TerminalInput;
  output?: TerminalOutput;
  timeoutMs: number;
  signalTarget?: SignalTarget;
}

export interface TerminalDsrRoundtripResult {
  result: TerminalRoundtripResult;
  durationMs: number;
  errorKind?: string;
  interrupted?: boolean;
}

export interface DsrParser {
  push(chunk: string | Buffer | Uint8Array): boolean;
}

export type TerminalDataListener = (chunk: Buffer | string | Uint8Array) => void;
export type TerminalErrorListener = (error: Error) => void;

export interface TerminalInput {
  isTTY?: boolean;
  isRaw?: boolean;
  isPaused?: () => boolean;
  setRawMode?: (mode: boolean) => TerminalInput;
  pause?: () => TerminalInput;
  resume?: () => TerminalInput;
  on: (
    event: 'data' | 'error',
    listener: TerminalDataListener | TerminalErrorListener
  ) => TerminalInput;
  off?: (
    event: 'data' | 'error',
    listener: TerminalDataListener | TerminalErrorListener
  ) => TerminalInput;
  removeListener?: (
    event: 'data' | 'error',
    listener: TerminalDataListener | TerminalErrorListener
  ) => TerminalInput;
}

export interface TerminalOutput {
  isTTY?: boolean;
  write: (chunk: string) => boolean;
  on?: (event: 'error', listener: TerminalErrorListener) => TerminalOutput;
  off?: (event: 'error', listener: TerminalErrorListener) => TerminalOutput;
  removeListener?: (event: 'error', listener: TerminalErrorListener) => TerminalOutput;
}

export interface SignalTarget {
  once: (event: 'SIGINT', listener: () => void) => SignalTarget;
  off?: (event: 'SIGINT', listener: () => void) => SignalTarget;
  removeListener?: (event: 'SIGINT', listener: () => void) => SignalTarget;
}

export function createDsrParser(): DsrParser {
  let buffer = '';

  return {
    push(chunk) {
      buffer += chunkToText(chunk);
      if (buffer.length > MAX_DSR_BUFFER_LENGTH) {
        buffer = buffer.slice(-MAX_DSR_BUFFER_LENGTH);
      }
      return DSR_RESPONSE_PATTERN.test(buffer);
    },
  };
}

export async function runTerminalRoundtripProbe(
  options: TerminalRoundtripProbeOptions
): Promise<TerminalRoundtripProbeRun> {
  const input: TerminalInput = options.input || process.stdin;
  const output: TerminalOutput = options.output || process.stdout;
  const filePath = options.filePath || buildTerminalRoundtripLogPath(options.runId);
  const transport = options.transport || inferDmuxPerfTransport();

  if (!input.isTTY || !output.isTTY) {
    const unsupportedResult: TerminalDsrRoundtripResult = {
      result: 'error',
      durationMs: 0,
      errorKind: 'unsupported-tty',
    };
    writeTerminalRoundtripEvent({
      runId: options.runId,
      instanceLabel: options.instanceLabel,
      transport,
      iteration: 1,
      durationMs: unsupportedResult.durationMs,
      result: unsupportedResult.result,
      filePath,
      metadata: { errorKind: unsupportedResult.errorKind },
    });
    return {
      filePath,
      results: [unsupportedResult],
      supported: false,
    };
  }

  const results: TerminalDsrRoundtripResult[] = [];
  const iterations = Math.max(1, options.iterations);

  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    const result = await runTerminalDsrRoundtrip({
      input,
      output,
      timeoutMs: options.timeoutMs,
      signalTarget: options.signalTarget,
    });
    results.push(result);
    writeTerminalRoundtripEvent({
      runId: options.runId,
      instanceLabel: options.instanceLabel,
      transport,
      iteration,
      durationMs: result.durationMs,
      result: result.result,
      filePath,
      metadata: result.errorKind ? { errorKind: result.errorKind } : undefined,
    });

    if (result.interrupted) {
      break;
    }
  }

  return {
    filePath,
    results,
    supported: true,
  };
}

export function runTerminalDsrRoundtrip(
  options: TerminalDsrRoundtripOptions
): Promise<TerminalDsrRoundtripResult> {
  const input: TerminalInput = options.input || process.stdin;
  const output: TerminalOutput = options.output || process.stdout;
  const signalTarget: SignalTarget = options.signalTarget || process;
  const startedAt = performance.now();

  if (!input.isTTY || !output.isTTY) {
    return Promise.resolve({
      result: 'error',
      durationMs: 0,
      errorKind: 'unsupported-tty',
    });
  }

  return new Promise((resolve) => {
    const parser = createDsrParser();
    const previousRawMode = Boolean(input.isRaw);
    const wasPaused = input.isPaused?.() === true;
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;

    const finish = (result: TerminalRoundtripResult, errorKind?: string, interrupted = false) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      removeInputDataListener(input, onData);
      removeInputErrorListener(input, onInputError);
      removeOutputErrorListener(output, onOutputError);
      removeSignalListener(signalTarget, onSigint);
      restoreRawMode(input, previousRawMode);
      restorePausedState(input, wasPaused);
      resolve({
        result,
        durationMs: performance.now() - startedAt,
        ...(errorKind ? { errorKind } : {}),
        ...(interrupted ? { interrupted } : {}),
      });
    };

    const onData = (chunk: Buffer | string | Uint8Array) => {
      if (parser.push(chunk)) {
        finish('success');
      }
    };
    const onInputError = () => finish('error', 'stdin-error');
    const onOutputError = () => finish('error', 'stdout-error');
    const onSigint = () => finish('error', 'sigint', true);

    try {
      input.on('data', onData);
      input.on('error', onInputError);
      output.on?.('error', onOutputError);
      signalTarget.once('SIGINT', onSigint);
      input.setRawMode?.(true);
      input.resume?.();
      timeout = setTimeout(() => finish('timeout'), Math.max(1, options.timeoutMs));
      output.write(DSR_REQUEST);
    } catch {
      finish('error', 'write-error');
    }
  });
}

export function writeTerminalRoundtripEvent(options: TerminalRoundtripEventOptions): string {
  const filePath = options.filePath || buildTerminalRoundtripLogPath(options.runId);
  const payload: DmuxPerfJsonEvent = {
    timestamp: new Date().toISOString(),
    monotonicMs: performance.now(),
    runId: options.runId,
    pid: process.pid,
    event: 'client.terminal_roundtrip',
    lane: 'client-observed',
    durationMs: options.durationMs,
    count: 1,
    instanceLabel: options.instanceLabel,
    transport: options.transport || inferDmuxPerfTransport(),
    metadata: {
      probe: 'terminal-dsr',
      iteration: options.iteration,
      result: options.result,
      ...options.metadata,
    },
  };

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
  return filePath;
}

export function writeClientInputWindowEvent(options: ClientInputWindowEventOptions): string {
  const transport = options.transport || inferDmuxPerfTransport();
  const filePath = options.filePath || buildClientInputWindowLogPath(options.runId);
  const summary = summarizeClientInputWindow({
    runId: options.runId,
    instanceLabel: options.instanceLabel,
    transport,
    startedAt: options.startedAt,
    stoppedAt: options.stoppedAt,
    perfDir: options.perfDir,
  });
  const dsrCounts = countDsrProbeResults([options.preProbe, options.postProbe]);
  const dsrSupportCounts = countDsrProbeSupport([options.preProbe, options.postProbe]);
  const payload: DmuxPerfJsonEvent = {
    timestamp: new Date().toISOString(),
    monotonicMs: performance.now(),
    runId: options.runId,
    pid: process.pid,
    event: 'client.input_window',
    lane: 'client-observed',
    durationMs: Math.max(0, options.stoppedAt.getTime() - options.startedAt.getTime()),
    count: 1,
    instanceLabel: options.instanceLabel,
    transport,
    metadata: {
      label: options.label,
      startedAt: options.startedAt.toISOString(),
      stoppedAt: options.stoppedAt.toISOString(),
      handledVisibleInputCount: summary.handledVisibleInputCount,
      matchedKeyToRenderCount: summary.matchedKeyToRenderCount,
      renderCount: summary.renderCount,
      dsrPreSupported: options.preProbe?.supported === true,
      dsrPostSupported: options.postProbe?.supported === true,
      dsrSupported: dsrSupportCounts.supported > 0,
      dsrSupportedCount: dsrSupportCounts.supported,
      dsrUnsupportedCount: dsrSupportCounts.unsupported,
      dsrSuccessCount: dsrCounts.success,
      dsrTimeoutCount: dsrCounts.timeout,
      dsrErrorCount: dsrCounts.error,
    },
  };

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
  return filePath;
}

export function summarizeClientInputWindow(options: {
  runId: string;
  instanceLabel?: string;
  transport?: string;
  startedAt: Date;
  stoppedAt: Date;
  perfDir?: string;
}): ClientInputWindowSummary {
  const startedAtMs = options.startedAt.getTime();
  const stoppedAtMs = options.stoppedAt.getTime();
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(stoppedAtMs) || stoppedAtMs < startedAtMs) {
    return emptyClientInputWindowSummary();
  }

  const events = readPerfEventsForRun(options.perfDir || getDmuxPerfDir(), options.runId)
    .filter((event) =>
      event.runId === options.runId
        && (options.instanceLabel === undefined || event.instanceLabel === options.instanceLabel)
        && (options.transport === undefined || event.transport === options.transport)
        && isEventInWallClockWindow(event, startedAtMs, stoppedAtMs)
    );
  const handledVisibleInputIds = new Set<string>();
  let handledVisibleInputCount = 0;
  let renderCount = 0;

  for (const event of events) {
    if (event.event === 'ui.input' && isHandledVisibleInput(event)) {
      handledVisibleInputCount += event.count || 1;
      const inputId = readStringMetadata(event, 'inputId');
      if (inputId) {
        handledVisibleInputIds.add(inputId);
      }
    } else if (event.event === 'ui.render') {
      renderCount += event.count || 1;
    }
  }

  const matchedKeyToRenderIds = new Set<string>();
  for (const event of events) {
    if (event.event !== 'ui.key_to_render') {
      continue;
    }
    const inputId = readStringMetadata(event, 'inputId');
    if (inputId && handledVisibleInputIds.has(inputId)) {
      matchedKeyToRenderIds.add(inputId);
    }
  }

  return {
    handledVisibleInputCount,
    matchedKeyToRenderCount: matchedKeyToRenderIds.size,
    renderCount,
  };
}

export function buildTerminalRoundtripLogPath(runId: string): string {
  return path.join(
    getDmuxPerfDir(),
    `dmux-client-${sanitizePathSegment(runId)}-${Date.now()}-${randomUUID().slice(0, 8)}.jsonl`
  );
}

export function buildClientInputWindowLogPath(runId: string): string {
  return path.join(
    getDmuxPerfDir(),
    `dmux-client-${sanitizePathSegment(runId)}-${Date.now()}-${randomUUID().slice(0, 8)}.jsonl`
  );
}

function emptyClientInputWindowSummary(): ClientInputWindowSummary {
  return {
    handledVisibleInputCount: 0,
    matchedKeyToRenderCount: 0,
    renderCount: 0,
  };
}

function readPerfEventsForRun(perfDir: string, runId: string): DmuxPerfJsonEvent[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(perfDir);
  } catch {
    return [];
  }

  const events: DmuxPerfJsonEvent[] = [];
  const sanitizedRunId = sanitizePathSegment(runId);
  const perfLogRunId = runId.replace(/[^a-zA-Z0-9._-]/g, '_');
  for (const entry of entries) {
    if (
      !entry.endsWith('.jsonl')
      || (!entry.includes(runId) && !entry.includes(sanitizedRunId) && !entry.includes(perfLogRunId))
    ) {
      continue;
    }

    try {
      const content = fs.readFileSync(path.join(perfDir, entry), 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        const event = JSON.parse(trimmed) as unknown;
        if (isPerfJsonEvent(event)) {
          events.push(event);
        }
      }
    } catch {
      // Client evidence should degrade to an empty summary instead of failing collection.
    }
  }
  return events;
}

function isPerfJsonEvent(value: unknown): value is DmuxPerfJsonEvent {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<DmuxPerfJsonEvent>;
  return typeof candidate.event === 'string' && typeof candidate.runId === 'string';
}

function isEventInWallClockWindow(
  event: DmuxPerfJsonEvent,
  startedAtMs: number,
  stoppedAtMs: number
): boolean {
  const timestampMs = Date.parse(event.timestamp);
  return Number.isFinite(timestampMs) && timestampMs >= startedAtMs && timestampMs <= stoppedAtMs;
}

function isHandledVisibleInput(event: DmuxPerfJsonEvent): boolean {
  return readStringMetadata(event, 'classification') === 'handled'
    && readBooleanMetadata(event, 'visibleStateChanged') === true;
}

function readStringMetadata(event: DmuxPerfJsonEvent, key: string): string | undefined {
  const value = event.metadata?.[key];
  return typeof value === 'string' ? value : undefined;
}

function readBooleanMetadata(event: DmuxPerfJsonEvent, key: string): boolean | undefined {
  const value = event.metadata?.[key];
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return undefined;
}

function countDsrProbeResults(
  probes: Array<TerminalRoundtripProbeRun | undefined>
): Record<TerminalRoundtripResult, number> {
  const counts: Record<TerminalRoundtripResult, number> = {
    success: 0,
    timeout: 0,
    error: 0,
  };
  for (const probe of probes) {
    for (const result of probe?.results || []) {
      counts[result.result] += 1;
    }
  }
  return counts;
}

function countDsrProbeSupport(
  probes: Array<TerminalRoundtripProbeRun | undefined>
): { supported: number; unsupported: number } {
  return probes.reduce(
    (counts, probe) => {
      if (!probe) {
        return counts;
      }
      if (probe.supported) {
        counts.supported += 1;
      } else {
        counts.unsupported += 1;
      }
      return counts;
    },
    { supported: 0, unsupported: 0 }
  );
}

function chunkToText(chunk: string | Buffer | Uint8Array): string {
  if (typeof chunk === 'string') {
    return chunk;
  }
  return Buffer.from(chunk).toString('utf8');
}

function restoreRawMode(input: TerminalInput, previousRawMode: boolean): void {
  try {
    input.setRawMode?.(previousRawMode);
  } catch {
    // Probe cleanup must not mask the original timeout/error result.
  }
}

function restorePausedState(input: TerminalInput, wasPaused: boolean): void {
  if (!wasPaused) {
    return;
  }

  try {
    input.pause?.();
  } catch {
    // Probe cleanup must not mask the original timeout/error result.
  }
}

function removeInputDataListener(
  input: TerminalInput,
  listener: (chunk: Buffer | string | Uint8Array) => void
): void {
  input.off?.('data', listener);
  input.removeListener?.('data', listener);
}

function removeInputErrorListener(input: TerminalInput, listener: (error: Error) => void): void {
  input.off?.('error', listener);
  input.removeListener?.('error', listener);
}

function removeOutputErrorListener(output: TerminalOutput, listener: (error: Error) => void): void {
  output.off?.('error', listener);
  output.removeListener?.('error', listener);
}

function removeSignalListener(signalTarget: SignalTarget, listener: () => void): void {
  signalTarget.off?.('SIGINT', listener);
  signalTarget.removeListener?.('SIGINT', listener);
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80) || 'run';
}
