#!/usr/bin/env node
import { randomUUID } from 'crypto';
import { createInterface } from 'readline/promises';
import { pathToFileURL } from 'url';
import { writeDmuxPerfClientInputWindow, writeDmuxPerfClientMarker } from './perf.js';
import { runTerminalRoundtripProbe } from './perfProbe.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || 'guide';

  if (command === 'marker') {
    writeMarker(args.slice(1));
    return;
  }

  if (command === 'probe') {
    await runProbe(args.slice(1));
    return;
  }

  if (command === 'collect-client') {
    await runCollectClient(args.slice(1));
    return;
  }

  printGuide(args.slice(command === 'guide' ? 1 : 0));
}

function printGuide(args: string[]): void {
  const runId = readOption(args, '--run-id') || randomUUID();
  const transport = readOption(args, '--transport') || 'eternal-terminal';
  console.log(buildPerfBenchmarkGuide(runId, transport));
}

export function buildPerfBenchmarkGuide(runId: string, transport: string): string {
  return [
    `Run id: ${runId}`,
    '',
    'Instance A:',
    `  DMUX_PERF=1 DMUX_PERF_RUN_ID=${runId} DMUX_PERF_INSTANCE=instance-a DMUX_PERF_TRANSPORT=${transport} pnpm dev`,
    '',
    'Instance B, for overlapping two-instance runs:',
    `  DMUX_PERF=1 DMUX_PERF_RUN_ID=${runId} DMUX_PERF_INSTANCE=instance-b DMUX_PERF_TRANSPORT=${transport} pnpm dev`,
    '',
    'Manual client markers, run near the client-observed navigation window:',
    '  Start both windows before navigating so instance-a and instance-b overlap.',
    'Terminal/transport RTT probes, run from the same transport class before and after navigation windows:',
    `  pnpm perf:probe -- --run-id ${runId} --instance instance-a --transport ${transport} --iterations 50 --timeout-ms 1000`,
    `  pnpm perf:probe -- --run-id ${runId} --instance instance-b --transport ${transport} --iterations 50 --timeout-ms 1000`,
    `  pnpm perf:collect-client -- --run-id ${runId} --instance instance-a --transport ${transport} --label navigation`,
    '',
    `  pnpm perf:mark -- --run-id ${runId} --instance instance-a --transport ${transport} --label navigation-start`,
    `  pnpm perf:mark -- --run-id ${runId} --instance instance-b --transport ${transport} --label navigation-start`,
    `  pnpm perf:mark -- --run-id ${runId} --instance instance-a --transport ${transport} --label navigation-stop`,
    `  pnpm perf:mark -- --run-id ${runId} --instance instance-b --transport ${transport} --label navigation-stop`,
    '',
    'Report:',
    `  pnpm perf:report -- --run-id ${runId}`,
  ].join('\n');
}

function writeMarker(args: string[]): void {
  const runId = readRequiredOption(args, '--run-id');
  const marker = readOption(args, '--label') || 'manual-marker';
  const instanceLabel = readOption(args, '--instance');
  const transport = readOption(args, '--transport');
  const filePath = writeDmuxPerfClientMarker({
    runId,
    marker,
    instanceLabel,
    transport,
  });
  console.log(`Wrote client marker: ${filePath}`);
}

export async function runCollectClient(args: string[]): Promise<void> {
  const runId = readRequiredOption(args, '--run-id');
  const instanceLabel = readOption(args, '--instance');
  const transport = readOption(args, '--transport');
  const label = readOption(args, '--label') || 'navigation';
  const iterations = readPositiveIntegerOption(args, '--iterations', 10);
  const timeoutMs = readPositiveIntegerOption(args, '--timeout-ms', 1000);
  const durationMs = readOptionalPositiveIntegerOption(args, '--duration-ms');
  if (durationMs === undefined && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    throw new Error('collect-client requires --duration-ms when stdin/stdout are noninteractive');
  }

  try {
    const beforeProbe = await runTerminalRoundtripProbe({
      runId,
      instanceLabel,
      transport,
      iterations,
      timeoutMs,
    });
    console.log(`Wrote pre-window terminal RTT probe events: ${beforeProbe.filePath}`);

    const windowStartedAt = new Date();
    const startPath = writeDmuxPerfClientMarker({
      runId,
      marker: `${label}-start`,
      instanceLabel,
      transport,
    });
    console.log(`Wrote client marker: ${startPath}`);

    await waitForClientWindow(durationMs);

    const windowStoppedAt = new Date();
    const stopPath = writeDmuxPerfClientMarker({
      runId,
      marker: `${label}-stop`,
      instanceLabel,
      transport,
    });
    console.log(`Wrote client marker: ${stopPath}`);

    const afterProbe = await runTerminalRoundtripProbe({
      runId,
      instanceLabel,
      transport,
      iterations,
      timeoutMs,
    });
    console.log(`Wrote post-window terminal RTT probe events: ${afterProbe.filePath}`);

    const combinedResults = [...beforeProbe.results, ...afterProbe.results];
    const inputWindowPath = writeDmuxPerfClientInputWindow({
      runId,
      instanceLabel,
      transport,
      label,
      startedAt: windowStartedAt.toISOString(),
      stoppedAt: windowStoppedAt.toISOString(),
      durationMs: Math.max(0, windowStoppedAt.getTime() - windowStartedAt.getTime()),
      dsrSupported: beforeProbe.supported || afterProbe.supported,
      dsrResults: countProbeResults(combinedResults),
    });
    console.log(`Wrote client input window: ${inputWindowPath}`);
  } finally {
    releaseProbeStdin();
  }
}

async function runProbe(args: string[]): Promise<void> {
  try {
    const runId = readRequiredOption(args, '--run-id');
    const instanceLabel = readOption(args, '--instance');
    const transport = readOption(args, '--transport');
    const iterations = readPositiveIntegerOption(args, '--iterations', 50);
    const timeoutMs = readPositiveIntegerOption(args, '--timeout-ms', 1000);
    const result = await runTerminalRoundtripProbe({
      runId,
      instanceLabel,
      transport,
      iterations,
      timeoutMs,
    });
    const counts = countProbeResults(result.results);

    if (!result.supported) {
      console.error(
        'perf:probe requires interactive TTY stdin/stdout; wrote client.terminal_roundtrip error event.'
      );
      console.error(`Wrote terminal RTT probe events: ${result.filePath}`);
      process.exitCode = 1;
      return;
    }

    console.log(`Wrote terminal RTT probe events: ${result.filePath}`);
    console.log(
      `Results: success=${counts.success} timeout=${counts.timeout} error=${counts.error}`
    );
    if (result.results.some((probeResult) => probeResult.interrupted)) {
      process.exitCode = 130;
    }
  } finally {
    releaseProbeStdin();
  }
}

function readRequiredOption(args: string[], name: string): string {
  const value = readOption(args, name);
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function readPositiveIntegerOption(args: string[], name: string, defaultValue: number): number {
  const rawValue = readOption(args, name);
  if (!rawValue) {
    return defaultValue;
  }
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function readOptionalPositiveIntegerOption(args: string[], name: string): number | undefined {
  const rawValue = readOption(args, name);
  if (!rawValue) {
    return undefined;
  }
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

async function waitForClientWindow(durationMs: number | undefined): Promise<void> {
  if (durationMs !== undefined) {
    console.log(`Client sample window open for ${durationMs}ms.`);
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('collect-client requires --duration-ms when stdin/stdout are noninteractive');
  }

  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    await readline.question('Client sample window open. Navigate dmux now, then press Enter to stop. ');
  } finally {
    readline.close();
  }
}

function countProbeResults(results: Array<{ result: 'success' | 'timeout' | 'error' }>): {
  success: number;
  timeout: number;
  error: number;
} {
  return results.reduce(
    (counts, result) => ({
      ...counts,
      [result.result]: counts[result.result] + 1,
    }),
    { success: 0, timeout: 0, error: 0 }
  );
}

function releaseProbeStdin(): void {
  try {
    process.stdin.pause();
  } catch {
    // Releasing probe stdin must not hide the probe result.
  }
  try {
    process.stdin.unref?.();
  } catch {
    // Some stdin implementations do not support unref.
  }
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

function isDirectRun(): boolean {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
}
