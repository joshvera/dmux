import { describe, expect, it } from 'vitest';
import {
  parseEternalTerminalKeepaliveLog,
} from '../src/utils/perfTransportImport.js';

describe('perf transport import', () => {
  it('pairs Eternal Terminal keepalives FIFO and filters by receive timestamp', () => {
    const result = parseEternalTerminalKeepaliveLog([
      '[INFO 2026-05-17 16:26:42,000 file.cc:1] Writing keepalive packet',
      '[INFO 2026-05-17 16:26:42,010 file.cc:1] Writing keepalive packet',
      '[INFO 2026-05-17 16:26:42,110 file.cc:1] Got a keepalive',
      '[INFO 2026-05-17 16:26:42,160 file.cc:1] Got a keepalive',
      '[INFO 2026-05-17 16:26:42,200 file.cc:1] Writing keepalive packet',
      '[INFO 2026-05-17 16:26:42,300 file.cc:1] Got a keepalive',
    ].join('\n'), {
      since: '2026-05-17T16:26:42.120',
      until: '2026-05-17T16:26:42.250',
    });

    expect(result.samples.map((sample) => sample.durationMs)).toEqual([150]);
    expect(result.samples.map((sample) => sample.sequence)).toEqual([1]);
    expect(result.counts).toMatchObject({
      samples: 1,
      filteredSamples: 2,
      unmatchedWrites: 0,
      unmatchedReads: 0,
      malformedTimestampLines: 0,
      invalidDurationSamples: 0,
    });
  });

  it('counts malformed timestamps, unmatched keepalives, and invalid durations without samples', () => {
    const result = parseEternalTerminalKeepaliveLog([
      'Writing keepalive packet',
      '[INFO 2026-05-17 16:26:42,100 file.cc:1] Got a keepalive',
      '[INFO 2026-05-17 16:26:42,200 file.cc:1] Writing keepalive packet',
      '[INFO 2026-05-17 16:26:42,100 file.cc:1] Got a keepalive',
      '[INFO 2026-05-17 16:26:42,300 file.cc:1] Writing keepalive packet',
    ].join('\n'));

    expect(result.samples).toEqual([]);
    expect(result.counts).toMatchObject({
      samples: 0,
      unmatchedWrites: 1,
      unmatchedReads: 1,
      malformedTimestampLines: 1,
      invalidDurationSamples: 1,
    });
  });

  it('rejects non-ISO filter boundaries', () => {
    expect(() =>
      parseEternalTerminalKeepaliveLog('', { since: 'last Tuesday' })
    ).toThrow('--since must be an ISO timestamp');
  });
});
