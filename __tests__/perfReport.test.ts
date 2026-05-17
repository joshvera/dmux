import { describe, expect, it } from 'vitest';
import type { DmuxPerfJsonEvent } from '../src/utils/perf.js';
import {
  buildPerfBenchmarkGuide,
} from '../src/utils/perfBenchmarkCli.js';
import {
  formatPerfReport,
  parsePerfJsonl,
  summarizePerfEvents,
} from '../src/utils/perfReport.js';

describe('perfReport', () => {
  it('parses JSONL and reports malformed lines without dropping valid events', () => {
    const parsed = parsePerfJsonl([
      JSON.stringify(event({ event: 'ui.render' })),
      '{not json',
      JSON.stringify({ event: 'missing-run' }),
    ].join('\n'));

    expect(parsed.events).toHaveLength(1);
    expect(parsed.errors).toHaveLength(2);
  });

  it('keeps server-observed and client-observed data separate', () => {
    const events = [
      ...Array.from({ length: 30 }, (_, index) =>
        event({
          event: 'ui.key_to_render',
          durationMs: 20 + index,
        })
      ),
      event({
        event: 'tmux.command',
        commandKind: 'list-panes',
        durationMs: 180,
        sync: true,
      }),
      event({
        event: 'perf.metadata',
        metadata: {
          sessionName: 'dmux-test',
          projectRootHash: 'abc123',
          paneCount: 2,
          workerCount: 1,
          terminalApp: 'Apple_Terminal',
          tmuxServerPid: 999,
        },
      }),
      event({
        event: 'runtime.host_snapshot',
        metadata: {
          process: {
            rss: 104_857_600,
            heapUsed: 52_428_800,
          },
          host: {
            loadavg: [1.25, 1.5, 1.75],
            freemem: 1_000_000,
            totalmem: 2_000_000,
          },
          tmuxServer: {
            pid: 999,
            cpuPercent: 2.5,
            rssKb: 40_960,
          },
        },
      }),
      event({
        event: 'client.marker',
        lane: 'client-observed',
        metadata: { marker: 'navigation-start' },
      }),
    ];

    const summary = summarizePerfEvents(events);
    const instance = summary.instances[0];

    expect(instance.serverEventCount).toBe(33);
    expect(instance.metadata).toMatchObject({
      sessionName: 'dmux-test',
      paneCount: 2,
      workerCount: 1,
      tmuxServerPid: 999,
      hostSnapshotCount: 1,
      tmuxServerCpuPercent: 2.5,
    });
    expect(instance.clientEventCount).toBe(1);
    expect(instance.clientMarkers).toEqual(['navigation-start']);
    expect(instance.likelyBottleneck).toBe('tmux command latency');

    const report = formatPerfReport(summary);
    expect(report).toContain('panes=2 workers=1');
    expect(report).toContain('tmuxCpu=2.5%');
  });

  it('marks insufficient key samples as inconclusive', () => {
    const summary = summarizePerfEvents([
      event({ event: 'ui.key_to_render', durationMs: 10 }),
      event({ event: 'tmux.command', durationMs: 200, commandKind: 'display-message' }),
    ]);

    const report = formatPerfReport(summary);

    expect(report).toContain('inconclusive: fewer than 30 key-to-render samples');
    expect(report).toContain('missing: key-to-render samples < 30');
  });

  it('prints client marker commands for both overlapping instances', () => {
    const guide = buildPerfBenchmarkGuide('guide-run', 'eternal-terminal');

    expect(guide).toContain('DMUX_PERF_INSTANCE=instance-a');
    expect(guide).toContain('DMUX_PERF_INSTANCE=instance-b');
    expect(guide).toContain('--instance instance-a --transport eternal-terminal --label navigation-start');
    expect(guide).toContain('--instance instance-b --transport eternal-terminal --label navigation-start');
    expect(guide).toContain('--instance instance-a --transport eternal-terminal --label navigation-stop');
    expect(guide).toContain('--instance instance-b --transport eternal-terminal --label navigation-stop');
    expect(guide).toContain('overlap');
  });
});

function event(overrides: Partial<DmuxPerfJsonEvent>): DmuxPerfJsonEvent {
  return {
    timestamp: '2026-05-17T00:00:00.000Z',
    monotonicMs: 1,
    runId: 'run-1',
    pid: 123,
    event: 'ui.render',
    lane: 'server-observed',
    instanceLabel: 'instance-a',
    transport: 'eternal-terminal',
    ...overrides,
  };
}
