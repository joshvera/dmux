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

export function buildTerminalRoundtripLogPath(runId: string): string {
  return path.join(
    getDmuxPerfDir(),
    `dmux-client-${sanitizePathSegment(runId)}-${Date.now()}-${randomUUID().slice(0, 8)}.jsonl`
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
