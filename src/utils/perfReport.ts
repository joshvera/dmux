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

export interface MetricBreakdown {
  label: string;
  stats: MetricStats;
  ratePerSecond: number;
}

export interface EventLoopOutlierSummary {
  thresholdMs: number;
  count: number;
  max?: EventLoopOutlier;
}

export interface EventLoopOutlier {
  durationMs: number;
  precedingEvent?: string;
  precedingDurationMs?: number;
  precedingDeltaMs?: number;
}

export interface InputClassificationCounts {
  handled: number;
  ignored: number;
  noop: number;
  unhandled: number;
}

export interface TerminalRoundtripResults {
  success: number;
  timeout: number;
  error: number;
  unknown: number;
}

export interface KeyToRenderExclusionCounts {
  orphaned: number;
  mismatched: number;
  duplicateExcess: number;
  missingInputId: number;
  invalidDuration: number;
}

export interface PerfInstanceSummary {
  runId: string;
  instanceLabel: string;
  transport: string;
  eventCount: number;
  serverEventCount: number;
  clientEventCount: number;
  durationSeconds: number;
  /**
   * Handled-visible key-to-render latency. Kept under the old field name so
   * existing callers continue to compile while reports stop mixing legacy raw
   * samples into the attribution metric.
   */
  keyToRender: MetricStats;
  handledKeyToRender: MetricStats;
  legacyKeyToRender: MetricStats;
  inputClassifications: InputClassificationCounts;
  terminalRoundtrip: MetricStats;
  terminalRoundtripResults: TerminalRoundtripResults;
  eventLoopLag: MetricStats;
  eventLoopOutliers: EventLoopOutlierSummary;
  tmuxCommand: MetricStats;
  tmuxCommandBreakdown: MetricBreakdown[];
  workerCapture: MetricStats;
  workerCaptureBreakdown: MetricBreakdown[];
  renderCount: number;
  renderPerSecond: number;
  stdoutBytes: number;
  stdoutBytesPerSecond: number;
  stdoutWriteBytes: MetricStats;
  stdoutBurstBytes100ms: MetricStats;
  renderBurstCount100ms: MetricStats;
  commandRatePerSecond: number;
  workerCaptureRatePerSecond: number;
  handledVisibleInputCount: number;
  orphanedKeyToRenderCount: number;
  keyToRenderExclusions: KeyToRenderExclusionCounts;
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
    lines.push(`  input classifications: ${formatInputClassifications(instance.inputClassifications)}`);
    lines.push(`  handled visible inputs: ${instance.handledVisibleInputCount}`);
    lines.push(`  handled key-to-render: ${formatStats(instance.handledKeyToRender)}`);
    lines.push(`  legacy raw key-to-render: ${formatStats(instance.legacyKeyToRender)}`);
    const exclusionText = formatKeyToRenderExclusions(instance.keyToRenderExclusions);
    if (exclusionText) {
      lines.push(`  excluded key-to-render: ${exclusionText}`);
    }
    if (instance.orphanedKeyToRenderCount > 0) {
      lines.push(`  orphaned key-to-render: ${instance.orphanedKeyToRenderCount}`);
    }
    lines.push(`  terminal roundtrip: ${formatStats(instance.terminalRoundtrip)} (${formatTerminalRoundtripResults(instance.terminalRoundtripResults)})`);
    lines.push(`  event-loop lag: ${formatStats(instance.eventLoopLag)}`);
    lines.push(`  event-loop outliers >${instance.eventLoopOutliers.thresholdMs}ms: ${formatEventLoopOutliers(instance.eventLoopOutliers)}`);
    lines.push(`  tmux commands: ${formatStats(instance.tmuxCommand)} (${formatNumber(instance.commandRatePerSecond)}/s)`);
    if (instance.tmuxCommandBreakdown.length > 0) {
      lines.push(`  tmux command breakdown: ${formatBreakdowns(instance.tmuxCommandBreakdown)}`);
    }
    lines.push(`  worker capture: ${formatStats(instance.workerCapture)} (${formatNumber(instance.workerCaptureRatePerSecond)}/s)`);
    if (instance.workerCaptureBreakdown.length > 0) {
      lines.push(`  worker capture breakdown: ${formatBreakdowns(instance.workerCaptureBreakdown)}`);
    }
    lines.push(`  renders: ${instance.renderCount} (${formatNumber(instance.renderPerSecond)}/s)`);
    lines.push(`  stdout bytes: ${instance.stdoutBytes} (${formatNumber(instance.stdoutBytesPerSecond)}/s, approximate)`);
    lines.push(`  stdout write bytes: ${formatValueStats(instance.stdoutWriteBytes, 'B')}`);
    lines.push(`  stdout burst bytes/100ms: ${formatValueStats(instance.stdoutBurstBytes100ms, 'B')}`);
    lines.push(`  render burst count/100ms: ${formatValueStats(instance.renderBurstCount100ms, '')}`);
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
  const keyToRenderIntegrity = summarizeKeyToRenderIntegrity(serverEvents);
  const handledKeyToRender = keyToRenderIntegrity.handled;
  const legacyKeyToRender = keyToRenderIntegrity.legacy;
  const inputClassifications = countInputClassifications(serverEvents);
  const terminalRoundtripEvents = events.filter((event) => event.event === 'client.terminal_roundtrip');
  const terminalRoundtrip = eventDurationStats(
    terminalRoundtripEvents,
    isTerminalRoundtripStatsSample
  );
  const terminalRoundtripResults = countTerminalRoundtripResults(terminalRoundtripEvents);
  const eventLoopLag = metricStats(serverEvents, 'runtime.event_loop_lag');
  const eventLoopOutliers = summarizeEventLoopOutliers(serverEvents);
  const tmuxCommand = metricStats(serverEvents, 'tmux.command');
  const tmuxCommandBreakdown = commandBreakdownStats(serverEvents, durationSeconds);
  const workerCapture = metricStats(serverEvents, 'worker.capture');
  const workerCaptureBreakdown = workerCaptureBreakdownStats(serverEvents, durationSeconds);
  const renderCount = serverEvents
    .filter((event) => event.event === 'ui.render')
    .reduce((total, event) => total + (event.count || 1), 0);
  const stdoutBytes = serverEvents
    .filter((event) => event.event === 'ui.stdout_write')
    .reduce((total, event) => total + (event.bytes || 0), 0);
  const stdoutWriteBytes = valueStats(
    serverEvents,
    (event) => event.event === 'ui.stdout_write',
    (event) => event.bytes
  );
  const stdoutBurstBytes100ms = bucketValueStats(
    serverEvents,
    100,
    (event) => event.event === 'ui.stdout_write',
    (event) => event.bytes || 0
  );
  const renderBurstCount100ms = bucketValueStats(
    serverEvents,
    100,
    (event) => event.event === 'ui.render',
    (event) => event.count || 1
  );
  const commandCount = serverEvents.filter((event) => event.event === 'tmux.command').length;
  const workerCaptureCount = serverEvents.filter((event) => event.event === 'worker.capture').length;
  const handledVisibleInputCount = countHandledVisibleInputs(serverEvents);
  const orphanedKeyToRenderCount = keyToRenderIntegrity.exclusions.orphaned;
  const clientMarkers = clientEvents
    .filter((event) => event.event === 'client.marker')
    .map((event) => readStringMetadata(event, 'marker'))
    .filter((value): value is string => value !== undefined);
  const metadata = summarizeMetadata(events);
  const missing = collectMissingMetrics({
    handledKeyToRender,
    legacyKeyToRender,
    eventLoopLag,
    tmuxCommand,
    workerCapture,
    terminalRoundtrip,
    clientMarkerCount: clientMarkers.length,
    handledVisibleInputCount,
    keyToRenderExclusions: keyToRenderIntegrity.exclusions,
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
    keyToRender: handledKeyToRender,
    handledKeyToRender,
    legacyKeyToRender,
    inputClassifications,
    terminalRoundtrip,
    terminalRoundtripResults,
    eventLoopLag,
    eventLoopOutliers,
    tmuxCommand,
    tmuxCommandBreakdown,
    workerCapture,
    workerCaptureBreakdown,
    renderCount,
    renderPerSecond: rate(renderCount, durationSeconds),
    stdoutBytes,
    stdoutBytesPerSecond: rate(stdoutBytes, durationSeconds),
    stdoutWriteBytes,
    stdoutBurstBytes100ms,
    renderBurstCount100ms,
    commandRatePerSecond: rate(commandCount, durationSeconds),
    workerCaptureRatePerSecond: rate(workerCaptureCount, durationSeconds),
    handledVisibleInputCount,
    orphanedKeyToRenderCount,
    keyToRenderExclusions: keyToRenderIntegrity.exclusions,
    clientMarkers,
    metadata,
    likelyBottleneck: inferLikelyBottleneck({
      handledKeyToRender,
      legacyKeyToRender,
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
  return eventDurationStats(events, (event) => event.event === eventName);
}

function eventDurationStats(
  events: DmuxPerfJsonEvent[],
  predicate: (event: DmuxPerfJsonEvent) => boolean
): MetricStats {
  return durationStats(
    events
      .filter(predicate)
      .map((event) => event.durationMs)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  );
}

function valueStats(
  events: DmuxPerfJsonEvent[],
  predicate: (event: DmuxPerfJsonEvent) => boolean,
  readValue: (event: DmuxPerfJsonEvent) => number | undefined
): MetricStats {
  return durationStats(
    events
      .filter(predicate)
      .map(readValue)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  );
}

function bucketValueStats(
  events: DmuxPerfJsonEvent[],
  bucketMs: number,
  predicate: (event: DmuxPerfJsonEvent) => boolean,
  readValue: (event: DmuxPerfJsonEvent) => number
): MetricStats {
  const buckets = new Map<number, number>();
  for (const event of events) {
    if (!predicate(event) || !Number.isFinite(event.monotonicMs)) {
      continue;
    }
    const bucket = Math.floor(event.monotonicMs / bucketMs);
    buckets.set(bucket, (buckets.get(bucket) || 0) + readValue(event));
  }
  return durationStats(Array.from(buckets.values()));
}

function commandBreakdownStats(
  events: DmuxPerfJsonEvent[],
  durationSeconds: number
): MetricBreakdown[] {
  return breakdownStats(
    events,
    durationSeconds,
    (event) => {
      if (event.event !== 'tmux.command') {
        return undefined;
      }

      const commandKind = event.commandKind || 'unknown';
      const syncKind = event.sync === false ? 'async' : 'sync';
      return `${commandKind}/${syncKind}`;
    }
  );
}

function workerCaptureBreakdownStats(
  events: DmuxPerfJsonEvent[],
  durationSeconds: number
): MetricBreakdown[] {
  return breakdownStats(
    events,
    durationSeconds,
    (event) => {
      if (event.event !== 'worker.capture') {
        return undefined;
      }

      const agent = readStringMetadata(event, 'agent') || 'unknown-agent';
      const statusBefore = readStringMetadata(event, 'statusBefore') || 'unknown-status';
      const pane = event.paneId || event.tmuxPaneId || 'unknown-pane';
      return `${agent}/${statusBefore}/${pane}`;
    }
  );
}

function breakdownStats(
  events: DmuxPerfJsonEvent[],
  durationSeconds: number,
  getLabel: (event: DmuxPerfJsonEvent) => string | undefined
): MetricBreakdown[] {
  const groups = new Map<string, DmuxPerfJsonEvent[]>();
  for (const event of events) {
    const label = getLabel(event);
    if (!label) {
      continue;
    }

    const group = groups.get(label) || [];
    group.push(event);
    groups.set(label, group);
  }

  return Array.from(groups.entries())
    .map(([label, group]) => ({
      label,
      stats: eventDurationStats(group, () => true),
      ratePerSecond: rate(group.length, durationSeconds),
    }))
    .sort((left, right) =>
      (right.stats.max || 0) - (left.stats.max || 0)
        || right.stats.count - left.stats.count
        || left.label.localeCompare(right.label)
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

function hasMetadataKey(event: DmuxPerfJsonEvent, key: string): boolean {
  return event.metadata ? Object.prototype.hasOwnProperty.call(event.metadata, key) : false;
}

function summarizeKeyToRenderIntegrity(events: DmuxPerfJsonEvent[]): {
  handled: MetricStats;
  legacy: MetricStats;
  exclusions: KeyToRenderExclusionCounts;
} {
  const inputsById = groupInputEventsById(events);
  const acceptedInputIds = new Set<string>();
  const handledDurations: number[] = [];
  const legacyDurations: number[] = [];
  const exclusions: KeyToRenderExclusionCounts = {
    orphaned: 0,
    mismatched: 0,
    duplicateExcess: 0,
    missingInputId: 0,
    invalidDuration: 0,
  };

  for (const event of events) {
    if (event.event !== 'ui.key_to_render') {
      continue;
    }

    if (!isFiniteDuration(event.durationMs)) {
      exclusions.invalidDuration += event.count || 1;
      continue;
    }

    if (isLegacyRawKeyToRender(event)) {
      legacyDurations.push(event.durationMs);
      continue;
    }

    const inputId = readStringMetadata(event, 'inputId');
    if (!inputId) {
      exclusions.missingInputId += event.count || 1;
      continue;
    }

    const inputEvents = inputsById.get(inputId) || [];
    if (inputEvents.length === 0) {
      exclusions.orphaned += event.count || 1;
      continue;
    }
    if (inputEvents.length !== 1) {
      exclusions.duplicateExcess += event.count || 1;
      continue;
    }

    const inputEvent = inputEvents[0];
    if (
      readStringMetadata(inputEvent, 'classification') !== 'handled'
      || readBooleanMetadata(inputEvent, 'visibleStateChanged') !== true
    ) {
      exclusions.mismatched += event.count || 1;
      continue;
    }

    if (acceptedInputIds.has(inputId)) {
      exclusions.duplicateExcess += event.count || 1;
      continue;
    }

    acceptedInputIds.add(inputId);
    handledDurations.push(event.durationMs);
  }

  return {
    handled: durationStats(handledDurations),
    legacy: durationStats(legacyDurations),
    exclusions,
  };
}

function groupInputEventsById(events: DmuxPerfJsonEvent[]): Map<string, DmuxPerfJsonEvent[]> {
  const groups = new Map<string, DmuxPerfJsonEvent[]>();
  for (const event of events) {
    if (event.event !== 'ui.input') {
      continue;
    }

    const inputId = readStringMetadata(event, 'inputId');
    if (!inputId) {
      continue;
    }

    const group = groups.get(inputId) || [];
    group.push(event);
    groups.set(inputId, group);
  }
  return groups;
}

function isFiniteDuration(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isLegacyRawKeyToRender(event: DmuxPerfJsonEvent): boolean {
  if (event.event !== 'ui.key_to_render') {
    return false;
  }

  return !hasMetadataKey(event, 'inputId')
    && !hasMetadataKey(event, 'classification')
    && !hasMetadataKey(event, 'visibleStateChanged');
}

function countHandledVisibleInputs(events: DmuxPerfJsonEvent[]): number {
  return events
    .filter((event) =>
      event.event === 'ui.input'
        && readStringMetadata(event, 'classification') === 'handled'
        && readBooleanMetadata(event, 'visibleStateChanged') === true
    )
    .reduce((total, event) => total + (event.count || 1), 0);
}

function countInputClassifications(events: DmuxPerfJsonEvent[]): InputClassificationCounts {
  const counts: InputClassificationCounts = {
    handled: 0,
    ignored: 0,
    noop: 0,
    unhandled: 0,
  };

  for (const event of events) {
    if (event.event !== 'ui.input') {
      continue;
    }

    const classification = readStringMetadata(event, 'classification');
    if (
      classification === 'handled'
      || classification === 'ignored'
      || classification === 'noop'
      || classification === 'unhandled'
    ) {
      counts[classification] += event.count || 1;
    } else {
      counts.unhandled += event.count || 1;
    }
  }

  return counts;
}

function countTerminalRoundtripResults(events: DmuxPerfJsonEvent[]): TerminalRoundtripResults {
  const counts: TerminalRoundtripResults = {
    success: 0,
    timeout: 0,
    error: 0,
    unknown: 0,
  };

  for (const event of events) {
    counts[readTerminalRoundtripResult(event)] += 1;
  }

  return counts;
}

function readTerminalRoundtripResult(event: DmuxPerfJsonEvent): keyof TerminalRoundtripResults {
  const result = readStringMetadata(event, 'result');
  if (result === 'success' || result === 'timeout' || result === 'error') {
    return result;
  }

  const status = readStringMetadata(event, 'status');
  if (status === 'success' || status === 'timeout' || status === 'error') {
    return status;
  }

  if (event.success === true) {
    return 'success';
  }
  if (event.success === false) {
    return 'error';
  }

  return 'unknown';
}

function isTerminalRoundtripStatsSample(event: DmuxPerfJsonEvent): boolean {
  if (event.event !== 'client.terminal_roundtrip') {
    return false;
  }

  const result = readTerminalRoundtripResult(event);
  return result === 'success' || result === 'unknown';
}

function summarizeEventLoopOutliers(
  events: DmuxPerfJsonEvent[],
  thresholdMs = 50
): EventLoopOutlierSummary {
  const outliers = events
    .filter((event) =>
      event.event === 'runtime.event_loop_lag'
        && typeof event.durationMs === 'number'
        && event.durationMs > thresholdMs
    )
    .sort((left, right) => (right.durationMs || 0) - (left.durationMs || 0));

  const maxEvent = outliers[0];
  if (!maxEvent || typeof maxEvent.durationMs !== 'number') {
    return { thresholdMs, count: 0 };
  }

  const precedingEvent = findPrecedingSignificantEvent(events, maxEvent);
  return {
    thresholdMs,
    count: outliers.length,
    max: {
      durationMs: maxEvent.durationMs,
      ...(precedingEvent
        ? {
            precedingEvent: formatEventLabel(precedingEvent),
            precedingDurationMs: precedingEvent.durationMs,
            precedingDeltaMs: Math.max(0, maxEvent.monotonicMs - precedingEvent.monotonicMs),
          }
        : {}),
    },
  };
}

function findPrecedingSignificantEvent(
  events: DmuxPerfJsonEvent[],
  target: DmuxPerfJsonEvent
): DmuxPerfJsonEvent | undefined {
  return events
    .filter((event) =>
      event.monotonicMs < target.monotonicMs
        && event.event !== 'runtime.event_loop_lag'
        && event.event !== 'runtime.host_snapshot'
        && event.event !== 'perf.metadata'
    )
    .sort((left, right) => right.monotonicMs - left.monotonicMs)[0];
}

function formatEventLabel(event: DmuxPerfJsonEvent): string {
  if (event.event === 'tmux.command') {
    return `${event.event}:${event.commandKind || 'unknown'}/${event.sync === false ? 'async' : 'sync'}`;
  }
  if (event.event === 'ui.stdout_write') {
    return `${event.event}:${formatInteger(event.bytes)}B`;
  }
  return event.event;
}

function collectMissingMetrics(input: {
  handledKeyToRender: MetricStats;
  legacyKeyToRender: MetricStats;
  eventLoopLag: MetricStats;
  tmuxCommand: MetricStats;
  workerCapture: MetricStats;
  terminalRoundtrip: MetricStats;
  clientMarkerCount: number;
  handledVisibleInputCount: number;
  keyToRenderExclusions: KeyToRenderExclusionCounts;
  metadata: PerfMetadataSummary;
}): string[] {
  const missing: string[] = [];
  if (input.handledKeyToRender.count < 30) {
    missing.push('handled visible key-to-render samples < 30');
  }
  if (input.handledKeyToRender.count === 0 && input.legacyKeyToRender.count > 0) {
    missing.push('only legacy raw key-to-render samples found');
  }
  if (input.eventLoopLag.count === 0) missing.push('event-loop lag');
  if (input.tmuxCommand.count === 0) missing.push('tmux command timings');
  if (input.workerCapture.count === 0) missing.push('worker capture timings');
  if (input.terminalRoundtrip.count === 0) missing.push('terminal roundtrip timings');
  if (input.clientMarkerCount === 0) missing.push('client-observed markers');
  for (const reason of formatKeyToRenderMissingReasons(input.keyToRenderExclusions)) {
    missing.push(reason);
  }
  if (
    input.handledVisibleInputCount > 0
    && input.handledKeyToRender.count > input.handledVisibleInputCount
  ) {
    missing.push('handled key-to-render samples exceed handled visible inputs');
  }
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
  handledKeyToRender: MetricStats;
  legacyKeyToRender: MetricStats;
  eventLoopLag: MetricStats;
  tmuxCommand: MetricStats;
  workerCapture: MetricStats;
  stdoutBytesPerSecond: number;
  renderPerSecond: number;
}): string {
  if (input.handledKeyToRender.count < 30) {
    if (input.handledKeyToRender.count === 0 && input.legacyKeyToRender.count > 0) {
      return 'inconclusive: only legacy raw key-to-render samples found';
    }
    return 'inconclusive: fewer than 30 handled visible key-to-render samples';
  }

  const keyP95 = input.handledKeyToRender.p95 || 0;
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

function formatInputClassifications(counts: InputClassificationCounts): string {
  return [
    `handled=${counts.handled}`,
    `ignored=${counts.ignored}`,
    `noop=${counts.noop}`,
    `unhandled=${counts.unhandled}`,
  ].join(' ');
}

function formatTerminalRoundtripResults(results: TerminalRoundtripResults): string {
  return [
    `success=${results.success}`,
    `timeout=${results.timeout}`,
    `error=${results.error}`,
    `unknown=${results.unknown}`,
  ].join(' ');
}

function formatKeyToRenderExclusions(counts: KeyToRenderExclusionCounts): string {
  const entries: [string, number][] = [
    ['orphaned', counts.orphaned],
    ['mismatched', counts.mismatched],
    ['duplicate/excess', counts.duplicateExcess],
    ['missing-input-id', counts.missingInputId],
    ['invalid-duration', counts.invalidDuration],
  ];
  const parts = entries
    .filter((entry) => entry[1] > 0)
    .map(([label, count]) => `${label}=${count}`);

  return parts.join(' ');
}

function formatKeyToRenderMissingReasons(counts: KeyToRenderExclusionCounts): string[] {
  const reasons: string[] = [];
  if (counts.orphaned > 0) {
    reasons.push(`orphaned handled key-to-render samples: ${counts.orphaned}`);
  }
  if (counts.mismatched > 0) {
    reasons.push(`mismatched key-to-render samples: ${counts.mismatched}`);
  }
  if (counts.duplicateExcess > 0) {
    reasons.push(`duplicate/excess key-to-render samples: ${counts.duplicateExcess}`);
  }
  if (counts.missingInputId > 0) {
    reasons.push(`key-to-render samples missing inputId: ${counts.missingInputId}`);
  }
  if (counts.invalidDuration > 0) {
    reasons.push(`key-to-render samples with invalid duration: ${counts.invalidDuration}`);
  }
  return reasons;
}

function formatEventLoopOutliers(summary: EventLoopOutlierSummary): string {
  if (summary.count === 0 || !summary.max) {
    return 'n=0';
  }

  const parts = [
    `n=${summary.count}`,
    `max=${formatNumber(summary.max.durationMs)}ms`,
  ];
  if (summary.max.precedingEvent) {
    parts.push(`nearest-before-max=${summary.max.precedingEvent}`);
  }
  if (summary.max.precedingDurationMs !== undefined) {
    parts.push(`preceding-duration=${formatNumber(summary.max.precedingDurationMs)}ms`);
  }
  if (summary.max.precedingDeltaMs !== undefined) {
    parts.push(`delta=${formatNumber(summary.max.precedingDeltaMs)}ms`);
  }
  return parts.join(' ');
}

function formatBreakdowns(breakdowns: MetricBreakdown[]): string {
  return breakdowns
    .slice(0, 6)
    .map((breakdown) =>
      `${breakdown.label} ${formatStats(breakdown.stats)} (${formatNumber(breakdown.ratePerSecond)}/s)`
    )
    .join('; ');
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

function formatValueStats(stats: MetricStats, unit: string): string {
  if (stats.count === 0) {
    return 'n=0';
  }

  const suffix = unit ? unit : '';
  return [
    `n=${stats.count}`,
    `p50=${formatNumber(stats.p50)}${suffix}`,
    `p95=${formatNumber(stats.p95)}${suffix}`,
    `max=${formatNumber(stats.max)}${suffix}`,
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
