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

  it('keeps attribution buckets separate across inputs, renders, and client probes', () => {
    const events = [
      ...Array.from({ length: 30 }, (_, index) =>
        event({
          event: 'ui.key_to_render',
          durationMs: 20 + index,
          metadata: {
            inputId: `input-${index}`,
            classification: 'handled',
            visibleStateChanged: true,
          },
        })
      ),
      ...Array.from({ length: 30 }, (_, index) =>
        event({
          event: 'ui.input',
          metadata: {
            inputId: `input-${index}`,
            classification: 'handled',
            visibleStateChanged: true,
          },
        })
      ),
      event({
        event: 'ui.key_to_render',
        durationMs: 250,
      }),
      event({
        event: 'ui.input',
        metadata: { classification: 'ignored' },
      }),
      event({
        event: 'ui.input',
        metadata: { classification: 'noop' },
      }),
      event({
        event: 'ui.input',
        metadata: { classification: 'unhandled' },
      }),
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
      event({
        event: 'client.terminal_roundtrip',
        lane: 'client-observed',
        durationMs: 42,
        metadata: {
          probe: 'terminal-dsr',
          iteration: 1,
          result: 'success',
        },
      }),
      event({
        event: 'client.terminal_roundtrip',
        lane: 'client-observed',
        durationMs: 60,
        metadata: {
          probe: 'terminal-dsr',
          iteration: 2,
          result: 'success',
        },
      }),
      event({
        event: 'client.terminal_roundtrip',
        lane: 'client-observed',
        durationMs: 1000,
        metadata: {
          probe: 'terminal-dsr',
          iteration: 3,
          result: 'timeout',
        },
      }),
    ];

    const summary = summarizePerfEvents(events);
    const instance = summary.instances[0];

    expect(instance.metadata).toMatchObject({
      sessionName: 'dmux-test',
      paneCount: 2,
      workerCount: 1,
      tmuxServerPid: 999,
      hostSnapshotCount: 1,
      tmuxServerCpuPercent: 2.5,
    });
    expect(instance.handledKeyToRender.count).toBe(30);
    expect(instance.keyToRender.count).toBe(30);
    expect(instance.legacyKeyToRender.count).toBe(1);
    expect(instance.inputClassifications).toEqual({
      handled: 30,
      ignored: 1,
      noop: 1,
      unhandled: 1,
    });
    expect(instance.handledVisibleInputCount).toBe(30);
    expect(instance.orphanedKeyToRenderCount).toBe(0);
    expect(instance.clientEventCount).toBe(4);
    expect(instance.clientMarkers).toEqual(['navigation-start']);
    expect(instance.terminalRoundtrip.count).toBe(2);
    expect(instance.terminalRoundtrip.p95).toBe(42);
    expect(instance.terminalRoundtripResults).toEqual({
      success: 2,
      timeout: 1,
      error: 0,
      unknown: 0,
    });
    expect(instance.likelyBottleneck).toBe('tmux command latency');

    const report = formatPerfReport(summary);
    expect(report).toContain('panes=2 workers=1');
    expect(report).toContain('tmuxCpu=2.5%');
    expect(report).toContain('input classifications: handled=30 ignored=1 noop=1 unhandled=1');
    expect(report).toContain('handled visible inputs: 30');
    expect(report).toContain('handled key-to-render: n=30');
    expect(report).toContain('legacy raw key-to-render: n=1');
    expect(report).toContain('terminal roundtrip: n=2');
    expect(report).toContain('success=2 timeout=1 error=0 unknown=0');
  });

  it('marks insufficient handled-visible key samples as inconclusive', () => {
    const summary = summarizePerfEvents([
      event({
        event: 'ui.key_to_render',
        durationMs: 10,
        metadata: {
          inputId: 'input-1',
          classification: 'handled',
          visibleStateChanged: true,
        },
      }),
      event({ event: 'tmux.command', durationMs: 200, commandKind: 'display-message' }),
    ]);

    const report = formatPerfReport(summary);

    expect(report).toContain('inconclusive: fewer than 30 handled visible key-to-render samples');
    expect(report).toContain('missing: handled visible key-to-render samples < 30');
  });

  it('reports command, render, stdout, and event-loop outlier breakdowns', () => {
    const summary = summarizePerfEvents([
      event({
        event: 'tmux.command',
        commandKind: 'list-panes',
        durationMs: 30,
        sync: true,
        monotonicMs: 10,
      }),
      event({
        event: 'tmux.command',
        commandKind: 'display-message',
        durationMs: 90,
        sync: false,
        monotonicMs: 20,
      }),
      event({
        event: 'ui.stdout_write',
        bytes: 1000,
        monotonicMs: 30,
      }),
      event({
        event: 'ui.render',
        count: 1,
        monotonicMs: 32,
      }),
      event({
        event: 'ui.stdout_write',
        bytes: 2000,
        monotonicMs: 35,
      }),
      event({
        event: 'ui.render',
        count: 1,
        monotonicMs: 36,
      }),
      event({
        event: 'runtime.event_loop_lag',
        durationMs: 75,
        monotonicMs: 40,
      }),
      event({
        event: 'worker.capture',
        durationMs: 12,
        paneId: 'pane-a',
        tmuxPaneId: '%1',
        metadata: {
          agent: 'codex',
          statusBefore: 'working',
        },
      }),
      event({
        event: 'worker.capture',
        durationMs: 90,
        paneId: 'pane-b',
        tmuxPaneId: '%2',
        metadata: {
          agent: 'claude',
          statusBefore: 'idle',
        },
      }),
      event({
        event: 'ui.key_to_render',
        durationMs: 25,
        metadata: {
          inputId: 'missing-input',
          classification: 'handled',
          visibleStateChanged: true,
        },
      }),
    ]);

    const instance = summary.instances[0];
    expect(instance.tmuxCommandBreakdown.map((breakdown) => breakdown.label)).toEqual([
      'display-message/async',
      'list-panes/sync',
    ]);
    expect(instance.stdoutWriteBytes.max).toBe(2000);
    expect(instance.stdoutBurstBytes100ms.max).toBe(3000);
    expect(instance.renderBurstCount100ms.max).toBe(2);
    expect(instance.eventLoopOutliers.count).toBe(1);
    expect(instance.workerCaptureBreakdown.map((breakdown) => breakdown.label)).toEqual([
      'claude/idle/pane-b',
      'codex/working/pane-a',
    ]);
    expect(instance.orphanedKeyToRenderCount).toBe(1);

    const report = formatPerfReport(summary);
    expect(report).toContain('event-loop outliers >50ms: n=1 max=75.00ms');
    expect(report).toContain('tmux command breakdown: display-message/async');
    expect(report).toContain('list-panes/sync');
    expect(report).toContain('worker capture breakdown: claude/idle/pane-b');
    expect(report).toContain('stdout burst bytes/100ms: n=1 p50=3000.00B');
    expect(report).toContain('render burst count/100ms: n=1 p50=2.00');
    expect(report).toContain('orphaned key-to-render: 1');
    expect(report).toContain('orphaned handled key-to-render samples: 1');
  });

  it('keeps legacy raw key-to-render samples parseable without treating them as handled', () => {
    const summary = summarizePerfEvents([
      event({ event: 'ui.key_to_render', durationMs: 10 }),
      event({ event: 'ui.key_to_render', durationMs: 20 }),
      event({ event: 'tmux.command', durationMs: 200, commandKind: 'display-message' }),
    ]);
    const instance = summary.instances[0];

    expect(instance.handledKeyToRender.count).toBe(0);
    expect(instance.keyToRender.count).toBe(0);
    expect(instance.legacyKeyToRender.count).toBe(2);

    const report = formatPerfReport(summary);

    expect(report).toContain('handled key-to-render: n=0');
    expect(report).toContain('legacy raw key-to-render: n=2');
    expect(report).toContain('inconclusive: only legacy raw key-to-render samples found');
    expect(report).toContain('missing: handled visible key-to-render samples < 30, only legacy raw key-to-render samples found');
  });

  it('prints client marker commands for both overlapping instances', () => {
    const guide = buildPerfBenchmarkGuide('guide-run', 'eternal-terminal');

    expect(guide).toContain('DMUX_PERF_INSTANCE=instance-a');
    expect(guide).toContain('DMUX_PERF_INSTANCE=instance-b');
    expect(guide).toContain('--instance instance-a --transport eternal-terminal --label navigation-start');
    expect(guide).toContain('--instance instance-b --transport eternal-terminal --label navigation-start');
    expect(guide).toContain('--instance instance-a --transport eternal-terminal --label navigation-stop');
    expect(guide).toContain('--instance instance-b --transport eternal-terminal --label navigation-stop');
    expect(guide).toContain('pnpm perf:collect-client -- --run-id guide-run --instance instance-a --transport eternal-terminal --label navigation');
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
