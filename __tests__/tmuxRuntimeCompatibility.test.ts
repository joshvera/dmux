import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { existsSync, readFileSync, statSync, writeFileSync, symlinkSync } from 'fs';
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
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

  it('skips write when content already matches', () => {
    // First write creates the file.
    const scriptPath = ensureOsc52CopyScript();
    const mtimeBefore = statSync(scriptPath).mtimeMs;

    // Second call should not rewrite.
    ensureOsc52CopyScript();
    const mtimeAfter = statSync(scriptPath).mtimeMs;

    expect(mtimeAfter).toBe(mtimeBefore);
  });

  it('does not follow symlinks', () => {
    const dmuxDir = join(tempDir, '.dmux');
    mkdirSync(dmuxDir, { recursive: true });
    const targetPath = join(tempDir, 'real-file.sh');
    writeFileSync(targetPath, 'original content');
    symlinkSync(targetPath, join(dmuxDir, 'osc52-copy.sh'));

    ensureOsc52CopyScript();

    // The symlink target should not be overwritten.
    expect(readFileSync(targetPath, 'utf-8')).toBe('original content');
  });
});
