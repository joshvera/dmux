import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { DmuxPerfJsonEvent } from './perf.js';

export interface PerfParseResult {
  events: DmuxPerfJsonEvent[];
  errors: string[];
}

export interface MetricStats {
  count: number;
  avg?: number;
  p50?: number;
  p95?: number;
  max?: number;
}

export interface PerfInstanceSummary {
  runId: string;
  instanceLabel: string;
  transport: string;
  eventCount: number;
  serverEventCount: number;
  clientEventCount: number;
  durationSeconds: number;
  keyToRender: MetricStats;
  eventLoopLag: MetricStats;
  tmuxCommand: MetricStats;
  workerCapture: MetricStats;
  renderCount: number;
  renderPerSecond: number;
  stdoutBytes: number;
  stdoutBytesPerSecond: number;
  commandRatePerSecond: number;
  workerCaptureRatePerSecond: number;
  clientMarkers: string[];
  metadata: PerfMetadataSummary;
  likelyBottleneck: string;
  missing: string[];
}

export interface PerfReportSummary {
  generatedAt: string;
  instances: PerfInstanceSummary[];
  parseErrors: string[];
}

export interface PerfMetadataSummary {
  sessionName?: string;
  projectRootHash?: string;
  paneCount?: number;
  workerCount?: number;
  terminalApp?: string;
  tmuxServerPid?: number;
  hostSnapshotCount: number;
  processRss?: number;
  processHeapUsed?: number;
  tmuxServerCpuPercent?: number;
  tmuxServerRssKb?: number;
  hostLoad1?: number;
  hostFreeMem?: number;
  hostTotalMem?: number;
}

interface EventGroupKey {
  runId: string;
  instanceLabel: string;
  transport: string;
}

export function parsePerfJsonl(content: string): PerfParseResult {
  const events: DmuxPerfJsonEvent[] = [];
  const errors: string[] = [];

  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isPerfEvent(parsed)) {
        events.push(parsed);
      } else {
        errors.push(`line ${index + 1}: missing event/runId`);
      }
    } catch (error) {
      errors.push(`line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { events, errors };
}

export async function loadPerfEventsFromDir(
  dir: string = path.join(os.homedir(), '.dmux', 'perf')
): Promise<PerfParseResult> {
  const events: DmuxPerfJsonEvent[] = [];
  const errors: string[] = [];

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    return {
      events,
      errors: [`failed to read ${dir}: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  for (const entry of entries) {
    if (!entry.endsWith('.jsonl')) {
      continue;
    }

    const filePath = path.join(dir, entry);
    try {
      const parsed = parsePerfJsonl(await fs.readFile(filePath, 'utf8'));
      events.push(...parsed.events);
      errors.push(...parsed.errors.map((message) => `${entry}: ${message}`));
    } catch (error) {
      errors.push(`${entry}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { events, errors };
}

export function summarizePerfEvents(
  events: DmuxPerfJsonEvent[],
  parseErrors: string[] = []
): PerfReportSummary {
  const groups = new Map<string, DmuxPerfJsonEvent[]>();

  for (const event of events) {
    const key = makeGroupKey({
      runId: event.runId || 'unknown-run',
      instanceLabel: event.instanceLabel || 'unknown-instance',
      transport: event.transport || 'unknown-transport',
    });
    const group = groups.get(key) || [];
    group.push(event);
    groups.set(key, group);
  }

  const instances = Array.from(groups.values())
    .map(summarizeGroup)
    .sort((left, right) =>
      `${left.runId}:${left.instanceLabel}`.localeCompare(`${right.runId}:${right.instanceLabel}`)
    );

  return {
    generatedAt: new Date().toISOString(),
    instances,
    parseErrors,
  };
}

export function formatPerfReport(summary: PerfReportSummary): string {
  const lines = [
    'Dmux perf report',
    `Generated: ${summary.generatedAt}`,
    '',
  ];

  if (summary.instances.length === 0) {
    lines.push('No perf events found.');
  }

  for (const instance of summary.instances) {
    lines.push(`Run ${instance.runId} / ${instance.instanceLabel} / ${instance.transport}`);
    lines.push(`  events: server=${instance.serverEventCount} client=${instance.clientEventCount} total=${instance.eventCount}`);
    lines.push(`  metadata: session=${instance.metadata.sessionName || 'n/a'} project=${instance.metadata.projectRootHash || 'n/a'} panes=${formatInteger(instance.metadata.paneCount)} workers=${formatInteger(instance.metadata.workerCount)} terminal=${instance.metadata.terminalApp || 'n/a'} tmuxPid=${formatInteger(instance.metadata.tmuxServerPid)}`);
    lines.push(`  host: snapshots=${instance.metadata.hostSnapshotCount} dmuxRss=${formatBytes(instance.metadata.processRss)} heap=${formatBytes(instance.metadata.processHeapUsed)} tmuxCpu=${formatPercent(instance.metadata.tmuxServerCpuPercent)} tmuxRss=${formatKilobytes(instance.metadata.tmuxServerRssKb)} load1=${formatNumber(instance.metadata.hostLoad1)}`);
    lines.push(`  window: ${formatNumber(instance.durationSeconds)}s`);
    lines.push(`  key-to-render: ${formatStats(instance.keyToRender)}`);
    lines.push(`  event-loop lag: ${formatStats(instance.eventLoopLag)}`);
    lines.push(`  tmux commands: ${formatStats(instance.tmuxCommand)} (${formatNumber(instance.commandRatePerSecond)}/s)`);
    lines.push(`  worker capture: ${formatStats(instance.workerCapture)} (${formatNumber(instance.workerCaptureRatePerSecond)}/s)`);
    lines.push(`  renders: ${instance.renderCount} (${formatNumber(instance.renderPerSecond)}/s)`);
    lines.push(`  stdout bytes: ${instance.stdoutBytes} (${formatNumber(instance.stdoutBytesPerSecond)}/s, approximate)`);
    lines.push(`  client markers: ${instance.clientMarkers.length === 0 ? 'none' : instance.clientMarkers.join(', ')}`);
    lines.push(`  likely bottleneck: ${instance.likelyBottleneck}`);
    if (instance.missing.length > 0) {
      lines.push(`  missing: ${instance.missing.join(', ')}`);
    }
    lines.push('');
  }

  if (summary.parseErrors.length > 0) {
    lines.push('Parse warnings:');
    for (const error of summary.parseErrors) {
      lines.push(`  - ${error}`);
    }
  }

  return lines.join('\n').trimEnd();
}

function summarizeGroup(events: DmuxPerfJsonEvent[]): PerfInstanceSummary {
  const first = events[0];
  const durationSeconds = getDurationSeconds(events);
  const serverEvents = events.filter((event) => event.lane !== 'client-observed');
  const clientEvents = events.filter((event) => event.lane === 'client-observed');
  const keyToRender = metricStats(serverEvents, 'ui.key_to_render');
  const eventLoopLag = metricStats(serverEvents, 'runtime.event_loop_lag');
  const tmuxCommand = metricStats(serverEvents, 'tmux.command');
  const workerCapture = metricStats(serverEvents, 'worker.capture');
  const renderCount = serverEvents
    .filter((event) => event.event === 'ui.render')
    .reduce((total, event) => total + (event.count || 1), 0);
  const stdoutBytes = serverEvents
    .filter((event) => event.event === 'ui.stdout_write')
    .reduce((total, event) => total + (event.bytes || 0), 0);
  const commandCount = serverEvents.filter((event) => event.event === 'tmux.command').length;
  const workerCaptureCount = serverEvents.filter((event) => event.event === 'worker.capture').length;
  const clientMarkers = clientEvents
    .filter((event) => event.event === 'client.marker')
    .map((event) => readStringMetadata(event, 'marker'))
    .filter((value): value is string => value !== undefined);
  const metadata = summarizeMetadata(events);
  const missing = collectMissingMetrics({
    keyToRender,
    eventLoopLag,
    tmuxCommand,
    workerCapture,
    clientMarkerCount: clientMarkers.length,
    metadata,
  });

  return {
    runId: first.runId || 'unknown-run',
    instanceLabel: first.instanceLabel || 'unknown-instance',
    transport: first.transport || 'unknown-transport',
    eventCount: events.length,
    serverEventCount: serverEvents.length,
    clientEventCount: clientEvents.length,
    durationSeconds,
    keyToRender,
    eventLoopLag,
    tmuxCommand,
    workerCapture,
    renderCount,
    renderPerSecond: rate(renderCount, durationSeconds),
    stdoutBytes,
    stdoutBytesPerSecond: rate(stdoutBytes, durationSeconds),
    commandRatePerSecond: rate(commandCount, durationSeconds),
    workerCaptureRatePerSecond: rate(workerCaptureCount, durationSeconds),
    clientMarkers,
    metadata,
    likelyBottleneck: inferLikelyBottleneck({
      keyToRender,
      eventLoopLag,
      tmuxCommand,
      workerCapture,
      stdoutBytesPerSecond: rate(stdoutBytes, durationSeconds),
      renderPerSecond: rate(renderCount, durationSeconds),
    }),
    missing,
  };
}

function isPerfEvent(value: unknown): value is DmuxPerfJsonEvent {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<DmuxPerfJsonEvent>;
  return typeof candidate.event === 'string' && typeof candidate.runId === 'string';
}

function makeGroupKey(key: EventGroupKey): string {
  return `${key.runId}\u0000${key.instanceLabel}\u0000${key.transport}`;
}

function metricStats(events: DmuxPerfJsonEvent[], eventName: string): MetricStats {
  return durationStats(
    events
      .filter((event) => event.event === eventName)
      .map((event) => event.durationMs)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  );
}

function durationStats(values: number[]): MetricStats {
  if (values.length === 0) {
    return { count: 0 };
  }

  const sorted = [...values].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    avg: total / sorted.length,
    p50: percentile(sorted, 0.50),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1],
  };
}

function percentile(sortedValues: number[], quantile: number): number {
  const index = Math.min(
    sortedValues.length - 1,
    Math.floor((sortedValues.length - 1) * quantile)
  );
  return sortedValues[index];
}

function getDurationSeconds(events: DmuxPerfJsonEvent[]): number {
  const timestamps = events
    .map((event) => Date.parse(event.timestamp))
    .filter((value) => Number.isFinite(value));
  if (timestamps.length < 2) {
    return 1;
  }

  const durationMs = Math.max(...timestamps) - Math.min(...timestamps);
  return Math.max(1, durationMs / 1000);
}

function rate(count: number, durationSeconds: number): number {
  return count / Math.max(1, durationSeconds);
}

function readStringMetadata(event: DmuxPerfJsonEvent, key: string): string | undefined {
  const value = event.metadata?.[key];
  return typeof value === 'string' ? value : undefined;
}

function collectMissingMetrics(input: {
  keyToRender: MetricStats;
  eventLoopLag: MetricStats;
  tmuxCommand: MetricStats;
  workerCapture: MetricStats;
  clientMarkerCount: number;
  metadata: PerfMetadataSummary;
}): string[] {
  const missing: string[] = [];
  if (input.keyToRender.count < 30) missing.push('key-to-render samples < 30');
  if (input.eventLoopLag.count === 0) missing.push('event-loop lag');
  if (input.tmuxCommand.count === 0) missing.push('tmux command timings');
  if (input.workerCapture.count === 0) missing.push('worker capture timings');
  if (input.clientMarkerCount === 0) missing.push('client-observed markers');
  if (input.metadata.paneCount === undefined) missing.push('pane count metadata');
  if (input.metadata.workerCount === undefined) missing.push('worker count metadata');
  if (input.metadata.tmuxServerPid === undefined) missing.push('tmux server pid');
  if (input.metadata.hostSnapshotCount === 0) missing.push('host snapshots');
  return missing;
}

function summarizeMetadata(events: DmuxPerfJsonEvent[]): PerfMetadataSummary {
  const metadataEvents = events.filter((event) => event.event === 'perf.metadata');
  const hostSnapshots = events.filter((event) => event.event === 'runtime.host_snapshot');
  const latestMetadata = mergeMetadataEvents(metadataEvents);
  const latestHostSnapshot = hostSnapshots[hostSnapshots.length - 1]?.metadata;
  const processStats = readRecord(latestHostSnapshot, 'process');
  const hostStats = readRecord(latestHostSnapshot, 'host');
  const tmuxServerStats = readRecord(latestHostSnapshot, 'tmuxServer');
  const hostLoad = hostStats ? hostStats.loadavg : undefined;

  return {
    sessionName: readString(latestMetadata, 'sessionName') || events[0]?.sessionName,
    projectRootHash: readString(latestMetadata, 'projectRootHash') || events[0]?.projectRootHash,
    paneCount: readNumber(latestMetadata, 'paneCount'),
    workerCount: readNumber(latestMetadata, 'workerCount'),
    terminalApp: readString(latestMetadata, 'terminalApp'),
    tmuxServerPid: readNumber(latestMetadata, 'tmuxServerPid'),
    hostSnapshotCount: hostSnapshots.length,
    processRss: readNumber(processStats, 'rss'),
    processHeapUsed: readNumber(processStats, 'heapUsed'),
    tmuxServerCpuPercent: readNumber(tmuxServerStats, 'cpuPercent'),
    tmuxServerRssKb: readNumber(tmuxServerStats, 'rssKb'),
    hostLoad1: Array.isArray(hostLoad) && typeof hostLoad[0] === 'number'
      ? hostLoad[0]
      : undefined,
    hostFreeMem: readNumber(hostStats, 'freemem'),
    hostTotalMem: readNumber(hostStats, 'totalmem'),
  };
}

function mergeMetadataEvents(events: DmuxPerfJsonEvent[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const event of events) {
    if (event.metadata) {
      Object.assign(merged, event.metadata);
    }
  }
  return merged;
}

function readRecord(
  record: Record<string, unknown> | undefined,
  key: string
): Record<string, unknown> | undefined {
  const value = record?.[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
}

function readNumber(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function inferLikelyBottleneck(input: {
  keyToRender: MetricStats;
  eventLoopLag: MetricStats;
  tmuxCommand: MetricStats;
  workerCapture: MetricStats;
  stdoutBytesPerSecond: number;
  renderPerSecond: number;
}): string {
  if (input.keyToRender.count < 30) {
    return 'inconclusive: fewer than 30 key-to-render samples';
  }

  const keyP95 = input.keyToRender.p95 || 0;
  const reasons: string[] = [];
  if ((input.eventLoopLag.p95 || 0) > Math.max(50, keyP95 * 0.5)) {
    reasons.push('ui/event-loop blocked');
  }
  if ((input.tmuxCommand.p95 || 0) > Math.max(50, keyP95 * 0.5)) {
    reasons.push('tmux command latency');
  }
  if ((input.workerCapture.p95 || 0) > 100) {
    reasons.push('worker capture pressure');
  }
  if (input.stdoutBytesPerSecond > 100_000 || input.renderPerSecond > 20) {
    reasons.push('stdout/render volume');
  }

  if (reasons.length === 0) {
    return 'inconclusive: no dominant server-observed bucket';
  }
  if (reasons.length === 1) {
    return reasons[0];
  }
  return `mixed: ${reasons.join(', ')}`;
}

function formatStats(stats: MetricStats): string {
  if (stats.count === 0) {
    return 'n=0';
  }

  return [
    `n=${stats.count}`,
    `p50=${formatNumber(stats.p50)}ms`,
    `p95=${formatNumber(stats.p95)}ms`,
    `max=${formatNumber(stats.max)}ms`,
  ].join(' ');
}

function formatNumber(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return 'n/a';
  }
  return value.toFixed(2);
}

function formatInteger(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return 'n/a';
  }
  return Math.round(value).toString();
}

function formatBytes(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return 'n/a';
  }
  return `${(value / 1024 / 1024).toFixed(1)}MB`;
}

function formatKilobytes(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return 'n/a';
  }
  return `${(value / 1024).toFixed(1)}MB`;
}

function formatPercent(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return 'n/a';
  }
  return `${value.toFixed(1)}%`;
}
