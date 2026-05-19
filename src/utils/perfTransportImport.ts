import * as fs from 'fs/promises';
import { writeDmuxPerfTransportRttEvent } from './perf.js';

const ET_KEEPALIVE_WRITE = 'Writing keepalive packet';
const ET_KEEPALIVE_READ = 'Got a keepalive';
const ET_LOG_TIMESTAMP_PATTERN =
  /^\[[A-Z]+\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}),(\d{3})(?:\s*(Z|[+-]\d{2}:?\d{2}))?[^\]]*\]\s*(.*)$/;

export interface TransportImportOptions {
  source: 'eternal-terminal';
  logPath: string;
  runId: string;
  instanceLabel?: string;
  transport?: string;
  since?: string;
  until?: string;
}

export interface ParsedTransportRttSample {
  durationMs: number;
  receivedAt: Date;
  sequence: number;
}

export interface TransportImportCounts {
  samples: number;
  unmatchedWrites: number;
  unmatchedReads: number;
  malformedTimestampLines: number;
  invalidDurationSamples: number;
  filteredSamples: number;
}

export interface TransportImportResult {
  samples: ParsedTransportRttSample[];
  counts: TransportImportCounts;
}

interface ParseOptions {
  since?: string;
  until?: string;
}

export async function importEternalTerminalKeepaliveLog(
  options: TransportImportOptions
): Promise<TransportImportResult> {
  if (options.source !== 'eternal-terminal') {
    throw new Error('only --source eternal-terminal is supported');
  }

  let content: string;
  try {
    content = await fs.readFile(options.logPath, 'utf8');
  } catch {
    throw new Error('failed to read transport log');
  }

  const result = parseEternalTerminalKeepaliveLog(content, options);
  for (const sample of result.samples) {
    writeDmuxPerfTransportRttEvent({
      runId: options.runId,
      instanceLabel: options.instanceLabel,
      transport: options.transport,
      durationMs: sample.durationMs,
      sequence: sample.sequence,
      source: 'eternal-terminal',
      parser: 'keepalive-log',
      timestamp: sample.receivedAt.toISOString(),
    });
  }
  return result;
}

export function parseEternalTerminalKeepaliveLog(
  content: string,
  options: ParseOptions = {}
): TransportImportResult {
  const since = parseOptionalIsoBoundary(options.since, '--since');
  const until = parseOptionalIsoBoundary(options.until, '--until');
  const pendingWrites: Date[] = [];
  const samples: ParsedTransportRttSample[] = [];
  const counts: TransportImportCounts = {
    samples: 0,
    unmatchedWrites: 0,
    unmatchedReads: 0,
    malformedTimestampLines: 0,
    invalidDurationSamples: 0,
    filteredSamples: 0,
  };

  for (const line of content.split(/\r?\n/)) {
    const keepaliveKind = classifyKeepaliveLine(line);
    if (!keepaliveKind) {
      continue;
    }

    const timestamp = parseEternalTerminalLogTimestamp(line);
    if (!timestamp) {
      counts.malformedTimestampLines += 1;
      continue;
    }

    if (keepaliveKind === 'write') {
      pendingWrites.push(timestamp);
      continue;
    }

    const sentAt = pendingWrites.shift();
    if (!sentAt) {
      counts.unmatchedReads += 1;
      continue;
    }

    const durationMs = timestamp.getTime() - sentAt.getTime();
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      counts.invalidDurationSamples += 1;
      continue;
    }

    if ((since && timestamp < since) || (until && timestamp > until)) {
      counts.filteredSamples += 1;
      continue;
    }

    samples.push({
      durationMs,
      receivedAt: timestamp,
      sequence: samples.length + 1,
    });
  }

  counts.samples = samples.length;
  counts.unmatchedWrites = pendingWrites.length;
  return { samples, counts };
}

function classifyKeepaliveLine(line: string): 'write' | 'read' | undefined {
  if (line.includes(ET_KEEPALIVE_WRITE)) {
    return 'write';
  }
  if (line.includes(ET_KEEPALIVE_READ)) {
    return 'read';
  }
  return undefined;
}

function parseEternalTerminalLogTimestamp(line: string): Date | undefined {
  const match = ET_LOG_TIMESTAMP_PATTERN.exec(line);
  if (!match) {
    return undefined;
  }

  const [, date, time, millis, timezone] = match;
  const normalizedTimezone = timezone
    ? normalizeTimezone(timezone)
    : '';
  const parsed = new Date(`${date}T${time}.${millis}${normalizedTimezone}`);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function normalizeTimezone(timezone: string): string {
  if (timezone === 'Z') {
    return timezone;
  }
  return timezone.includes(':')
    ? timezone
    : `${timezone.slice(0, 3)}:${timezone.slice(3)}`;
}

function parseOptionalIsoBoundary(value: string | undefined, optionName: string): Date | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`${optionName} must be an ISO timestamp`);
  }
  return parsed;
}
