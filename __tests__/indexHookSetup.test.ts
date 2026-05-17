import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const indexSource = fs.readFileSync(
  path.join(process.cwd(), 'src', 'index.ts'),
  'utf-8'
);

describe('index tmux hook setup', () => {
  it('does not install legacy pane event hooks before PaneEventService owns them', () => {
    expect(indexSource).not.toContain('setupPaneSplitHook');
    expect(indexSource).not.toContain('setupPaneFocusHook');
    expect(indexSource).not.toContain('cleanupPaneSplitHook');
    expect(indexSource).not.toContain('cleanupPaneFocusHook');
  });

  it('appends the resize hook and cleans up only marked resize entries', () => {
    expect(indexSource).toContain('tmux set-hook -a -t ${shellQuote(sessionName)} client-resized');
    expect(indexSource).toContain('# dmux-resize-hook');
    expect(indexSource).not.toContain("tmux set-hook -u -t '${sessionName}' client-resized");
  });
});
