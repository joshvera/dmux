import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render } from "ink-testing-library"
import { Text } from "ink"
import { useInputHandling } from "../src/hooks/useInputHandling.js"
import { TmuxService } from "../src/services/TmuxService.js"
import type { DmuxPane } from "../src/types.js"
import {
  PaneAction,
  TOGGLE_PANE_VISIBILITY_ACTION,
} from "../src/actions/index.js"
import {
  drainRemotePaneActions,
  getCurrentTmuxSessionName,
} from "../src/utils/remotePaneActions.js"

vi.mock("../src/utils/tmux.js", async () => {
  const actual = await vi.importActual<typeof import("../src/utils/tmux.js")>("../src/utils/tmux.js")
  return {
    ...actual,
    enforceControlPaneSize: vi.fn(async () => {}),
  }
})

vi.mock("../src/utils/remotePaneActions.js", () => ({
  drainRemotePaneActions: vi.fn(async () => []),
  getCurrentTmuxSessionName: vi.fn(() => null),
}))

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function pane(id: string, options: Partial<DmuxPane> = {}): DmuxPane {
  return {
    id,
    slug: `pane-${id}`,
    prompt: `prompt-${id}`,
    paneId: `%${id}`,
    projectRoot: "/repo-a",
    projectName: "repo-a",
    worktreePath: `/repo-a/.dmux/worktrees/pane-${id}`,
    ...options,
  }
}

function Harness({
  panes,
  popupManager,
  actionSystem,
  savePanes = vi.fn(async () => {}),
  loadPanes = vi.fn(async () => {}),
}: {
  panes: DmuxPane[]
  popupManager: any
  actionSystem: any
  savePanes?: ReturnType<typeof vi.fn>
  loadPanes?: ReturnType<typeof vi.fn>
}) {
  useInputHandling({
    panes,
    selectedIndex: 0,
    setSelectedIndex: vi.fn(),
    isCreatingPane: false,
    setIsCreatingPane: vi.fn(),
    runningCommand: false,
    isUpdating: false,
    isLoading: false,
    ignoreInput: false,
    isDevMode: false,
    quitConfirmMode: false,
    setQuitConfirmMode: vi.fn(),
    showCommandPrompt: null,
    setShowCommandPrompt: vi.fn(),
    commandInput: "",
    setCommandInput: vi.fn(),
    showFileCopyPrompt: false,
    setShowFileCopyPrompt: vi.fn(),
    currentCommandType: null,
    setCurrentCommandType: vi.fn(),
    projectSettings: {},
    saveSettings: vi.fn(),
    settingsManager: {
      updateSetting: vi.fn(),
      getEffectiveScope: vi.fn(() => "global"),
    },
    popupManager,
    actionSystem,
    controlPaneId: "%0",
    trackProjectActivity: vi.fn(async (work: () => unknown) => await work()),
    presentationMode: "focus",
    popupsSupported: true,
    setStatusMessage: vi.fn(),
    copyNonGitFiles: vi.fn(),
    runCommandInternal: vi.fn(),
    handlePaneCreationWithAgent: vi.fn(async () => []),
    handleCreateChildWorktree: vi.fn(async () => []),
    handleReopenWorktree: vi.fn(async () => null),
    setDevSourceFromPane: vi.fn(),
    savePanes,
    sidebarProjects: [{ projectRoot: "/repo-a", projectName: "repo-a" }],
    saveSidebarProjects: vi.fn(async (projects) => projects),
    loadPanes,
    cleanExit: vi.fn(),
    availableAgents: ["claude"],
    panesFile: "/repo-a/.dmux/dmux.config.json",
    projectRoot: "/repo-a",
    projectActionItems: [],
    findCardInDirection: vi.fn(() => null),
  })

  return <Text>dmux</Text>
}

describe("useInputHandling focus pane menu", () => {
  const tmuxServiceMock = {
    selectPane: vi.fn(async () => {}),
    joinPaneToTarget: vi.fn(async () => {}),
    breakPaneToWindow: vi.fn(async () => {}),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getCurrentTmuxSessionName).mockReturnValue("dmux-test")
    vi.spyOn(TmuxService, "getInstance").mockReturnValue(
      tmuxServiceMock as unknown as TmuxService
    )
  })

  async function renderWithRemoteMenuAction(actionId: string) {
    const popupManager = {
      launchKebabMenuPopup: vi.fn(async () => actionId),
    }
    const actionSystem = {
      actionState: {},
      executeAction: vi.fn(async () => {}),
      executeCallback: vi.fn(async (callback: any) => callback?.()),
      clearDialog: vi.fn(),
      clearStatus: vi.fn(),
      setActionState: vi.fn(),
    }

    vi.mocked(drainRemotePaneActions)
      .mockResolvedValueOnce([{
        type: "pane-shortcut",
        targetPaneId: "%1",
        shortcut: "m",
        createdAt: "2026-03-28T08:00:00.000Z",
      }])
      .mockResolvedValue([])

    const renderResult = render(
      <Harness
        panes={[pane("1"), pane("2", { hidden: true })]}
        popupManager={popupManager}
        actionSystem={actionSystem}
      />
    )

    await sleep(80)

    return {
      ...renderResult,
      popupManager,
      actionSystem,
    }
  }

  it("uses the standard pane-anchored kebab menu in focus mode", async () => {
    const { popupManager, actionSystem, unmount } = await renderWithRemoteMenuAction(PaneAction.RENAME)

    expect(popupManager.launchKebabMenuPopup).toHaveBeenCalledWith(
      expect.objectContaining({ id: "1", paneId: "%1" }),
      expect.any(Array),
      { anchorToPane: true }
    )
    expect(actionSystem.executeAction).toHaveBeenCalledWith(
      PaneAction.RENAME,
      expect.objectContaining({ id: "1" }),
      expect.objectContaining({ mainBranch: expect.any(String) })
    )

    unmount()
  })

  it("can hide the selected pane through the anchored kebab menu in focus mode", async () => {
    const { popupManager, unmount } = await renderWithRemoteMenuAction(TOGGLE_PANE_VISIBILITY_ACTION)

    expect(popupManager.launchKebabMenuPopup).toHaveBeenCalled()
    expect(tmuxServiceMock.breakPaneToWindow).toHaveBeenCalledWith("%1", "dmux-hidden-1")

    unmount()
  })
})
