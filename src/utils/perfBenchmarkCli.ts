#!/usr/bin/env node
import { randomUUID } from 'crypto';
import { pathToFileURL } from 'url';
import { writeDmuxPerfClientMarker } from './perf.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || 'guide';

  if (command === 'marker') {
    writeMarker(args.slice(1));
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

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

function isDirectRun(): boolean {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
}
