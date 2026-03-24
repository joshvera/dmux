import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FocusNavigatorPopupApp } from '../src/components/popups/focusNavigatorPopup.js';
import { createCanonicalFocusModeFixture } from './fixtures/focusMode.js';

const UP = '\u001B[A';
const tempDirs: string[] = [];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('FocusNavigatorPopupApp', () => {
  it('renders project rows including empty sidebar projects and selects the active pane row', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmux-focus-navigator-'));
    tempDirs.push(tempDir);
    const resultFile = path.join(tempDir, 'result.json');
    const fixture = createCanonicalFocusModeFixture();

    const { lastFrame, unmount } = render(
      <FocusNavigatorPopupApp
        resultFile={resultFile}
        data={{
          panes: fixture.panes,
          sidebarProjects: fixture.sidebarProjects,
          projectRoot: fixture.sessionProjectRoot,
          projectName: fixture.sessionProjectName,
          selectedPaneId: fixture.selectedPane.id,
          selectedProjectRoot: fixture.selectedPane.projectRoot,
        }}
      />
    );

    const output = stripAnsi(lastFrame() ?? '');

    expect(output).toContain('repo-a');
    expect(output).toContain('repo-empty');
    expect(output).toContain('No panes');
    expect(output).toContain('> Alpha One');
    expect(output).toContain('Enter switch | x close | g merge | m more | n/t/r project actions | Esc cancel');

    unmount();
  });

  it('switches footer actions as selection moves between pane, project, and exit rows', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmux-focus-navigator-'));
    tempDirs.push(tempDir);
    const resultFile = path.join(tempDir, 'result.json');
    const fixture = createCanonicalFocusModeFixture();

    const { stdin, lastFrame, unmount } = render(
      <FocusNavigatorPopupApp
        resultFile={resultFile}
        data={{
          panes: fixture.panes,
          sidebarProjects: fixture.sidebarProjects,
          projectRoot: fixture.sessionProjectRoot,
          projectName: fixture.sessionProjectName,
          selectedPaneId: fixture.selectedPane.id,
          selectedProjectRoot: fixture.selectedPane.projectRoot,
        }}
      />
    );

    await sleep(20);
    expect(stripAnsi(lastFrame() ?? '')).toContain(
      'Enter switch | x close | g merge | m more | n/t/r project actions | Esc cancel'
    );

    stdin.write(UP);
    await sleep(20);
    expect(stripAnsi(lastFrame() ?? '')).toContain(
      'n new agent | t new terminal | r reopen | Esc cancel'
    );

    stdin.write(UP);
    await sleep(20);
    expect(stripAnsi(lastFrame() ?? '')).toContain(
      'Enter exit focus | Esc cancel'
    );

    unmount();
  });

  it('keeps Enter as a no-op on project rows but still supports project shortcuts and pane more actions', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmux-focus-navigator-'));
    tempDirs.push(tempDir);
    const projectResultFile = path.join(tempDir, 'project-result.json');
    const fixture = createCanonicalFocusModeFixture();

    const projectRender = render(
      <FocusNavigatorPopupApp
        resultFile={projectResultFile}
        data={{
          panes: [],
          sidebarProjects: fixture.sidebarProjects,
          projectRoot: fixture.sessionProjectRoot,
          projectName: fixture.sessionProjectName,
          selectedProjectRoot: fixture.selectedPane.projectRoot,
        }}
      />
    );

    await sleep(20);
    projectRender.stdin.write('\r');
    await sleep(20);
    expect(fs.existsSync(projectResultFile)).toBe(false);

    projectRender.stdin.write('n');
    await sleep(30);
    expect(JSON.parse(fs.readFileSync(projectResultFile, 'utf8'))).toEqual({
      success: true,
      data: {
        kind: 'project',
        action: 'new-agent',
        projectRoot: '/repo-a',
      },
    });
    projectRender.unmount();

    const paneResultFile = path.join(tempDir, 'pane-result.json');
    const paneRender = render(
      <FocusNavigatorPopupApp
        resultFile={paneResultFile}
        data={{
          panes: fixture.panes,
          sidebarProjects: fixture.sidebarProjects,
          projectRoot: fixture.sessionProjectRoot,
          projectName: fixture.sessionProjectName,
          selectedPaneId: fixture.selectedPane.id,
          selectedProjectRoot: fixture.selectedPane.projectRoot,
        }}
      />
    );

    await sleep(20);
    paneRender.stdin.write('m');
    await sleep(30);
    expect(JSON.parse(fs.readFileSync(paneResultFile, 'utf8'))).toEqual({
      success: true,
      data: {
        kind: 'pane',
        action: 'more',
        paneId: fixture.selectedPane.id,
      },
    });

    paneRender.unmount();
  });
});
