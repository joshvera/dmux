import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import FooterHelp from '../src/components/ui/FooterHelp.js';

describe('FooterHelp', () => {
  it('shows detach confirmation copy when quit confirm mode is active', () => {
    const { lastFrame } = render(
      <FooterHelp show={true} quitConfirmMode={true} />
    );

    expect(stripAnsi(lastFrame() ?? '')).toContain(
      'Press q or Ctrl+C again to detach'
    );
  });
});
