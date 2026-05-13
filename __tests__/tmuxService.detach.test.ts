import { describe, expect, it } from 'vitest';
import {
  buildDetachClientCommand,
  buildSwitchClientKeyTableCommand,
  CLIENT_ACTIVITY_COMMAND,
  CLIENT_KEY_TABLE_COMMAND,
  parseClientKeyTable,
  parseContextualClientTty,
  parseMostRecentClientTty,
} from '../src/utils/tmuxClient.js';

describe('tmux client helpers', () => {
  it('uses real tab separators in tmux list-client format commands', () => {
    expect(CLIENT_ACTIVITY_COMMAND).toBe(
      'tmux list-clients -F "#{client_activity}\t#{client_tty}"'
    );
    expect(CLIENT_KEY_TABLE_COMMAND).toBe(
      'tmux list-clients -F "#{client_tty}\t#{client_key_table}"'
    );
  });

  it('parses the contextual client tty when tmux reports one', () => {
    expect(parseContextualClientTty('  /dev/ttys001\n')).toBe('/dev/ttys001');
  });

  it('returns null for an empty contextual client tty', () => {
    expect(parseContextualClientTty('   ')).toBeNull();
  });

  it('selects the most recently active client tty', () => {
    expect(parseMostRecentClientTty([
      '100\t/dev/ttys001',
      '250\t/dev/ttys002',
      '200\t/dev/ttys003',
    ].join('\n'))).toBe('/dev/ttys002');
  });

  it('ignores malformed client activity lines', () => {
    expect(parseMostRecentClientTty([
      'not-a-number\t/dev/ttys001',
      '300\t',
      '25\t/dev/ttys002',
    ].join('\n'))).toBe('/dev/ttys002');
  });

  it('returns null when tmux reports no client tty', () => {
    expect(parseMostRecentClientTty('   ')).toBeNull();
  });

  it('parses the matching client key table', () => {
    expect(parseClientKeyTable([
      '/dev/ttys001\troot',
      '/dev/ttys002\tprefix',
      '/dev/ttys003\tdmux-detach-confirm',
    ].join('\n'), '/dev/ttys002')).toBe('prefix');
  });

  it('returns null when no client key table matches', () => {
    expect(parseClientKeyTable('/dev/ttys001\troot', '/dev/ttys999')).toBeNull();
  });

  it('builds a quoted detach-client command', () => {
    expect(buildDetachClientCommand('/dev/ttys001')).toBe(
      "tmux detach-client -t '/dev/ttys001'"
    );
  });

  it('shell-quotes client tty values in detach commands', () => {
    expect(buildDetachClientCommand("/tmp/client's-tty")).toBe(
      "tmux detach-client -t '/tmp/client'\\''s-tty'"
    );
  });

  it('builds a targeted root key table command', () => {
    expect(buildSwitchClientKeyTableCommand('root', '/dev/ttys001')).toBe(
      "tmux switch-client -c '/dev/ttys001' -T root"
    );
  });

  it('builds an untargeted detach confirmation key table command', () => {
    expect(buildSwitchClientKeyTableCommand('dmux-detach-confirm')).toBe(
      "tmux switch-client -T 'dmux-detach-confirm'"
    );
  });
});
