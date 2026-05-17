import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LAYOUT_CONFIG, recalculateAndApplyLayout } from '../src/utils/layoutManager.js';

const syncTmuxMethods = vi.hoisted(() => ({
  getAllPaneIdsSync: vi.fn(() => {
    throw new Error('sync getAllPaneIdsSync should not be used');
  }),
  getPaneTitleSync: vi.fn(() => {
    throw new Error('sync getPaneTitleSync should not be used');
  }),
  listPanesSync: vi.fn(() => {
    throw new Error('sync listPanesSync should not be used');
  }),
  getPanePositionsSync: vi.fn(() => {
    throw new Error('sync getPanePositionsSync should not be used');
  }),
  getWindowDimensionsSync: vi.fn(() => {
    throw new Error('sync getWindowDimensionsSync should not be used');
  }),
  getStatusBarHeightSync: vi.fn(() => {
    throw new Error('sync getStatusBarHeightSync should not be used');
  }),
  setWindowOptionSync: vi.fn(() => {
    throw new Error('sync setWindowOptionSync should not be used');
  }),
  selectLayoutSync: vi.fn(() => {
    throw new Error('sync selectLayoutSync should not be used');
  }),
  resizePaneSync: vi.fn(() => {
    throw new Error('sync resizePaneSync should not be used');
  }),
  resizeWindowSync: vi.fn(() => {
    throw new Error('sync resizeWindowSync should not be used');
  }),
  selectPaneSync: vi.fn(() => {
    throw new Error('sync selectPaneSync should not be used');
  }),
  splitPaneSync: vi.fn(() => {
    throw new Error('sync splitPaneSync should not be used');
  }),
  killPaneSync: vi.fn(() => {
    throw new Error('sync killPaneSync should not be used');
  }),
  getCurrentPaneIdSync: vi.fn(() => {
    throw new Error('sync getCurrentPaneIdSync should not be used');
  }),
}));

const asyncTmuxService = vi.hoisted(() => ({
  ...syncTmuxMethods,
  getAllPaneIds: vi.fn(async () => ['%0', '%1', '%2']),
  getPaneTitle: vi.fn(async () => ''),
  listPanes: vi.fn(async () => '%0=0\n%1=1\n%2=2'),
  paneExists: vi.fn(async () => true),
  getPanePositions: vi.fn(async () => [
    { paneId: '%0', left: 0, top: 0, width: 40, height: 59 },
    { paneId: '%1', left: 41, top: 0, width: 79, height: 59 },
    { paneId: '%2', left: 121, top: 0, width: 79, height: 59 },
  ]),
  getWindowDimensions: vi.fn(async () => ({ width: 200, height: 59 })),
  getStatusBarHeight: vi.fn(async () => 1),
  setWindowOption: vi.fn(async () => {}),
  resizeWindow: vi.fn(async () => {}),
  resizePane: vi.fn(async () => {}),
  selectLayout: vi.fn(async () => {}),
  selectPane: vi.fn(async () => {}),
  splitPane: vi.fn(async () => '%3'),
  setPaneTitle: vi.fn(async () => {}),
  getCurrentPaneId: vi.fn(async () => '%1'),
  killPane: vi.fn(async () => {}),
}));

vi.mock('../src/services/TmuxService.js', () => ({
  TmuxService: {
    getInstance: () => asyncTmuxService,
  },
}));

describe('recalculateAndApplyLayout async tmux path', () => {
  beforeEach(() => {
    for (const method of Object.values(asyncTmuxService)) {
      method.mockClear();
    }
    asyncTmuxService.getAllPaneIds.mockImplementation(async () => ['%0', '%1', '%2']);
    asyncTmuxService.getPaneTitle.mockImplementation(async () => '');
    asyncTmuxService.listPanes.mockImplementation(async () => '%0=0\n%1=1\n%2=2');
    asyncTmuxService.paneExists.mockImplementation(async () => true);
    asyncTmuxService.getPanePositions.mockImplementation(async () => [
      { paneId: '%0', left: 0, top: 0, width: 40, height: 59 },
      { paneId: '%1', left: 41, top: 0, width: 79, height: 59 },
      { paneId: '%2', left: 121, top: 0, width: 79, height: 59 },
    ]);
    asyncTmuxService.getWindowDimensions.mockImplementation(async () => ({ width: 200, height: 59 }));
    asyncTmuxService.getStatusBarHeight.mockImplementation(async () => 1);
  });

  it('does not call synchronous tmux helpers while applying layout', async () => {
    await recalculateAndApplyLayout(
      '%0',
      ['%1', '%2'],
      200,
      60,
      DEFAULT_LAYOUT_CONFIG,
      { disableSpacer: true, force: true, suppressLogs: true }
    );

    expect(asyncTmuxService.getAllPaneIds).toHaveBeenCalled();
    expect(asyncTmuxService.listPanes).toHaveBeenCalledWith('#{pane_id}=#{pane_index}');
    expect(asyncTmuxService.getWindowDimensions).toHaveBeenCalled();
    expect(asyncTmuxService.selectLayout).toHaveBeenCalled();

    for (const method of Object.values(syncTmuxMethods)) {
      expect(method).not.toHaveBeenCalled();
    }
  });

  it('keeps spacer creation on the async tmux path', async () => {
    asyncTmuxService.getAllPaneIds.mockImplementation(async () => [
      '%0',
      '%1',
      '%2',
      '%3',
      '%4',
    ]);
    asyncTmuxService.listPanes.mockImplementation(async () => [
      '%0=0',
      '%1=1',
      '%2=2',
      '%3=3',
      '%4=4',
    ].join('\n'));
    asyncTmuxService.getWindowDimensions.mockImplementation(async () => ({ width: 180, height: 59 }));
    asyncTmuxService.splitPane.mockImplementation(async () => '%4');

    await recalculateAndApplyLayout(
      '%0',
      ['%1', '%2', '%3'],
      180,
      60,
      DEFAULT_LAYOUT_CONFIG,
      { force: true, suppressLogs: true }
    );

    expect(asyncTmuxService.splitPane).toHaveBeenCalled();
    expect(asyncTmuxService.setPaneTitle).toHaveBeenCalledWith('%4', 'dmux-spacer');
    expect(asyncTmuxService.selectLayout).toHaveBeenCalled();

    for (const method of Object.values(syncTmuxMethods)) {
      expect(method).not.toHaveBeenCalled();
    }
  });
});
