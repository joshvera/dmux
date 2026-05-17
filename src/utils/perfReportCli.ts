#!/usr/bin/env node
import * as os from 'os';
import * as path from 'path';
import {
  formatPerfReport,
  loadPerfEventsFromDir,
  summarizePerfEvents,
} from './perfReport.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dir = readOption(args, '--dir')
    || process.env.DMUX_PERF_DIR
    || path.join(os.homedir(), '.dmux', 'perf');
  const runId = readOption(args, '--run-id');
  const parsed = await loadPerfEventsFromDir(dir);
  const events = runId
    ? parsed.events.filter((event) => event.runId === runId)
    : parsed.events;

  const summary = summarizePerfEvents(events, parsed.errors);
  console.log(formatPerfReport(summary));
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
