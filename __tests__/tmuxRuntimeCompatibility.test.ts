import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { existsSync, readFileSync, statSync } from 'fs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const mockHomedir = vi.hoisted(() => vi.fn<() => string>());
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: mockHomedir };
});

import {
  buildTmuxRuntimeCompatibilityCommands,
  ensureOsc52CopyScript,
  parseTmuxArrayOptionValues,
} from '../src/utils/tmuxRuntimeCompatibility.js';


describe('tmuxRuntimeCompatibility', () => {
  it('parses tmux array option output', () => {
    const parsed = parseTmuxArrayOptionValues(
      [
        'terminal-overrides[0] linux*:AX@',
        'terminal-overrides[1] "*:Ms=\\\\E]52;c;%p2%s\\\\007"',
        'update-environment[8]* TERM_PROGRAM',
      ].join('\n')
    );

    expect(parsed).toEqual([
      'linux*:AX@',
      '*:Ms=\\\\E]52;c;%p2%s\\\\007',
      'TERM_PROGRAM',
    ]);
  });

  it('builds runtime commands for missing compatibility settings', () => {
    const commands = buildTmuxRuntimeCompatibilityCommands('dmux-test', {
      terminalOverrides: [],
      updateEnvironment: [],
    });

    expect(commands).toEqual([
      ['set-option', '-q', '-t', 'dmux-test', 'set-clipboard', 'on'],
      ['set-option', '-q', '-t', 'dmux-test', 'allow-passthrough', 'all'],
      ['set-option', '-q', '-ag', '-t', 'dmux-test', 'update-environment', 'TERM_PROGRAM'],
      ['set-option', '-q', '-ag', '-t', 'dmux-test', 'terminal-overrides', '*:Ms=\\E]52;c;%p2%s\\007'],
    ]);
  });

  it('does not duplicate array entries already present', () => {
    const commands = buildTmuxRuntimeCompatibilityCommands('dmux-test', {
      terminalOverrides: ['linux*:AX@', '*:Ms=\\E]52;c;%p2%s\\007'],
      updateEnvironment: ['DISPLAY', 'TERM_PROGRAM'],
    });

    expect(commands).toEqual([
      ['set-option', '-q', '-t', 'dmux-test', 'set-clipboard', 'on'],
      ['set-option', '-q', '-t', 'dmux-test', 'allow-passthrough', 'all'],
    ]);
  });
});

describe('ensureOsc52CopyScript', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'dmux-test-'));
    mockHomedir.mockReturnValue(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes an executable script with OSC 52 content', () => {
    const scriptPath = ensureOsc52CopyScript();

    expect(scriptPath).toBe(join(tempDir, '.dmux', 'osc52-copy.sh'));
    expect(existsSync(scriptPath)).toBe(true);

    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('#!/bin/sh');
    expect(content).toContain('base64');
    expect(content).toContain('\\033]52;c;');
    expect(content).toContain('client_tty');

    const mode = statSync(scriptPath).mode & 0o777;
    expect(mode & 0o111).not.toBe(0); // executable
  });
});
