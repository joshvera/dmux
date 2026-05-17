import { describe, expect, it } from 'vitest';
import { runCollectClient } from '../src/utils/perfBenchmarkCli.js';

describe('perfBenchmarkCli', () => {
  it('requires --duration-ms for noninteractive collect-client runs', async () => {
    await expect(
      runCollectClient([
        '--run-id',
        'noninteractive-run',
        '--instance',
        'instance-a',
        '--transport',
        'local',
      ])
    ).rejects.toThrow('requires --duration-ms');
  });
});
