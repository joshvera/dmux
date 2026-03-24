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
import { createShellPane } from "../src/utils/shellPaneDetection.js"
import {
  drainRemotePaneActions,
  getCurrentTmuxSessionName,
} from "../src/utils/remotePaneActions.js"
import { buildFilesOnlyCommand } from "../src/utils/dmuxCommand.js"
import { attachAgentToWorktree } from "../src/utils/attachAgent.js"
import { createCanonicalFocusModeFixture } from "./fixtures/focusMode.js"

vi.mock("../src/utils/tmux.js", async () => {
  const actual = await vi.importActual<typeof import("../src/utils/tmux.js")>("../src/utils/tmux.js")
  return {
    ...actual,
    enforceControlPaneSize: vi.fn(async () => {}),
  }
})

vi.mock("../src/utils/shellPaneDetection.js", async () => {
  const actual = await vi.importActual<typeof import("../src/utils/shellPaneDetection.js")>("../src/utils/shellPaneDetection.js")
  return {
    ...actual,
    createShellPane: vi.fn(async (paneId: string, nextId: number) => ({
      id: `dmux-${nextId}`,
      slug: `shell-${nextId}`,
      prompt: "",
      paneId,
      projectRoot: "/repo-a",
      projectName: "repo-a",
      type: "shell",
      shellType: "zsh",
    })),
  }
})

vi.mock("../src/utils/remotePaneActions.js", () => ({
  drainRemotePaneActions: vi.fn(async () => []),
  getCurrentTmuxSessionName: vi.fn(() => null),
}))

vi.mock("../src/utils/attachAgent.js", () => ({
  attachAgentToWorktree: vi.fn(async ({ targetPane, existingPanes }: any) => ({
    pane: {
      id: `dmux-${existingPanes.length + 1}`,
      slug: `${targetPane.slug}-a2`,
      prompt: "attached agent",
      paneId: `%${existingPanes.length + 1}`,
      projectRoot: targetPane.projectRoot,
      projectName: targetPane.projectName,
      worktreePath: targetPane.worktreePath,
      type: "worktree",
      agent: "claude",
    },
  })),
}))

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function Harness({
  panes,
  popupManager,
  actionSystem,
  isDevMode = false,
  availableAgents = ["claude"],
  sidebarProjects = [{ projectRoot: "/repo-a", projectName: "repo-a" }],
  savePanes = vi.fn(async () => {}),
  loadPanes = vi.fn(async () => {}),
  handleCreateChildWorktree = vi.fn(async () => []),
  setDevSourceFromPane = vi.fn(async () => {}),
  setStatusMessage = vi.fn(),
}: {
  panes: DmuxPane[]
  popupManager: any
  actionSystem: any
  isDevMode?: boolean
  availableAgents?: string[]
  sidebarProjects?: { projectRoot: string; projectName: string }[]
  savePanes?: ReturnType<typeof vi.fn>
  loadPanes?: ReturnType<typeof vi.fn>
  handleCreateChildWorktree?: ReturnType<typeof vi.fn>
  setDevSourceFromPane?: ReturnType<typeof vi.fn>
  setStatusMessage?: ReturnType<typeof vi.fn>
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
    isDevMode,
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
    setStatusMessage,
    copyNonGitFiles: vi.fn(),
    runCommandInternal: vi.fn(),
    handlePaneCreationWithAgent: vi.fn(async () => []),
    handleCreateChildWorktree,
    handleReopenWorktree: vi.fn(async () => null),
    setDevSourceFromPane,
    savePanes,
    sidebarProjects,
    saveSidebarProjects: vi.fn(async (projects) => projects),
    loadPanes,
    cleanExit: vi.fn(),
    availableAgents: availableAgents as any,
    panesFile: "/repo-a/.dmux/dmux.config.json",
    projectRoot: "/repo-a",
    projectActionItems: [],
    findCardInDirection: vi.fn(() => null),
  })

  return <Text>dmux</Text>
}

describe("useInputHandling focus action sheet", () => {
  const tmuxServiceMock = {
    selectPane: vi.fn(async () => {}),
    setPaneZoom: vi.fn(async () => {}),
    isWindowZoomed: vi.fn(async () => false),
    joinPaneToTarget: vi.fn(async () => {}),
    breakPaneToWindow: vi.fn(async () => {}),
    splitPane: vi.fn(async () => "%6"),
    setPaneTitle: vi.fn(async () => {}),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getCurrentTmuxSessionName).mockReturnValue("dmux-test")
    vi.spyOn(TmuxService, "getInstance").mockReturnValue(
      tmuxServiceMock as unknown as TmuxService
    )
  })

  function createPopupManager(actionId: string) {
    return {
      launchFocusNavigatorPopup: vi.fn(async () => ({
        kind: "pane",
        action: "more",
        paneId: "dmux-1",
      })),
      launchFocusActionSheetPopup: vi.fn(async () => actionId),
      launchNewPanePopup: vi.fn(async () => "Ship it"),
    }
  }

  async function triggerMoreAction(
    actionId: string,
    options: Partial<Parameters<typeof Harness>[0]> & { panes?: DmuxPane[] } = {}
  ) {
    const fixture = createCanonicalFocusModeFixture()
    const popupManager = createPopupManager(actionId)
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
        targetPaneId: fixture.selectedPane.paneId,
        shortcut: "m",
        createdAt: "2026-03-23T03:00:00.000Z",
      }])
      .mockResolvedValue([])

    const renderResult = render(
      <Harness
        panes={options.panes || fixture.panes}
        popupManager={popupManager}
        actionSystem={actionSystem}
        isDevMode={options.isDevMode}
        availableAgents={options.availableAgents as any}
        sidebarProjects={options.sidebarProjects as any}
        savePanes={options.savePanes}
        loadPanes={options.loadPanes}
        handleCreateChildWorktree={options.handleCreateChildWorktree}
        setDevSourceFromPane={options.setDevSourceFromPane}
        setStatusMessage={options.setStatusMessage}
      />
    )

    await vi.waitFor(() => {
      expect(popupManager.launchFocusNavigatorPopup).toHaveBeenCalled()
      expect(popupManager.launchFocusActionSheetPopup).toHaveBeenCalled()
    })

    return {
      ...renderResult,
      fixture,
      popupManager,
      actionSystem,
    }
  }

  it.each([
    PaneAction.RENAME,
    PaneAction.COPY_PATH,
    PaneAction.OPEN_IN_EDITOR,
    PaneAction.TOGGLE_AUTOPILOT,
  ])("dispatches %s through actionSystem exactly once", async (actionId) => {
    const { fixture, actionSystem, unmount } = await triggerMoreAction(actionId)

    expect(actionSystem.executeAction).toHaveBeenCalledWith(
      actionId,
      expect.objectContaining({ id: fixture.selectedPane.id }),
      expect.objectContaining({ mainBranch: expect.any(String) })
    )

    unmount()
  })

  it("dispatches set_source through the dev source callback", async () => {
    const setDevSourceFromPane = vi.fn(async () => {})
    const { fixture, unmount } = await triggerMoreAction(PaneAction.SET_SOURCE, {
      isDevMode: true,
      setDevSourceFromPane,
    })

    expect(setDevSourceFromPane).toHaveBeenCalledWith(
      expect.objectContaining({ id: fixture.selectedPane.id })
    )

    unmount()
  })

  it("dispatches create child worktree through the injected callback", async () => {
    const handleCreateChildWorktree = vi.fn(async () => [])
    const { fixture, unmount } = await triggerMoreAction(
      PaneAction.CREATE_CHILD_WORKTREE,
      { handleCreateChildWorktree }
    )

    expect(handleCreateChildWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ id: fixture.selectedPane.id })
    )

    unmount()
  })

  it("dispatches attach agent through the attachAgentToWorktree flow", async () => {
    const savePanes = vi.fn(async () => {})
    const loadPanes = vi.fn(async () => {})
    const { fixture, popupManager, unmount } = await triggerMoreAction(
      PaneAction.ATTACH_AGENT,
      { savePanes, loadPanes }
    )

    await vi.waitFor(() => {
      expect(popupManager.launchNewPanePopup).toHaveBeenCalledWith("/repo-a")
      expect(attachAgentToWorktree).toHaveBeenCalledWith(
        expect.objectContaining({
          targetPane: expect.objectContaining({ id: fixture.selectedPane.id }),
        })
      )
      expect(savePanes).toHaveBeenCalled()
      expect(loadPanes).toHaveBeenCalled()
    })

    unmount()
  })

  it("dispatches open terminal in worktree through tmux split and shell pane persistence", async () => {
    const savePanes = vi.fn(async () => {})
    const loadPanes = vi.fn(async () => {})
    const { fixture, unmount } = await triggerMoreAction(
      PaneAction.OPEN_TERMINAL_IN_WORKTREE,
      { savePanes, loadPanes }
    )

    await vi.waitFor(() => {
      expect(tmuxServiceMock.splitPane).toHaveBeenCalledWith({
        cwd: fixture.selectedPane.worktreePath,
        preserveZoom: true,
      })
      expect(createShellPane).toHaveBeenCalledWith("%6", 6)
      expect(savePanes).toHaveBeenCalled()
      expect(loadPanes).toHaveBeenCalled()
    })

    unmount()
  })

  it("dispatches open file browser in worktree through a files-only pane", async () => {
    const savePanes = vi.fn(async () => {})
    const loadPanes = vi.fn(async () => {})
    const { fixture, unmount } = await triggerMoreAction(
      PaneAction.OPEN_FILE_BROWSER,
      { savePanes, loadPanes }
    )

    await vi.waitFor(() => {
      expect(tmuxServiceMock.splitPane).toHaveBeenCalledWith({
        cwd: fixture.selectedPane.worktreePath,
        command: buildFilesOnlyCommand(),
        preserveZoom: true,
      })
      expect(tmuxServiceMock.setPaneTitle).toHaveBeenCalledWith("%6", expect.stringContaining("files-"))
      expect(savePanes).toHaveBeenCalled()
      expect(loadPanes).toHaveBeenCalled()
    })

    unmount()
  })

  it("dispatches hide pane through the visibility mutation path", async () => {
    const savePanes = vi.fn(async () => {})
    const loadPanes = vi.fn(async () => {})
    const { fixture, actionSystem, unmount } = await triggerMoreAction(
      TOGGLE_PANE_VISIBILITY_ACTION,
      { savePanes, loadPanes }
    )

    expect(tmuxServiceMock.breakPaneToWindow).toHaveBeenCalledWith(
      fixture.selectedPane.paneId,
      `dmux-hidden-${fixture.selectedPane.id}`
    )
    expect(actionSystem.executeAction).not.toHaveBeenCalled()
    expect(savePanes).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: fixture.selectedPane.id, hidden: true }),
      ])
    )
    expect(loadPanes).toHaveBeenCalled()

    unmount()
  })

  it("dispatches hide others through the bulk visibility mutation path", async () => {
    const savePanes = vi.fn(async () => {})
    const loadPanes = vi.fn(async () => {})
    const { fixture, unmount } = await triggerMoreAction("hide-others", {
      savePanes,
      loadPanes,
    })

    expect(tmuxServiceMock.breakPaneToWindow).toHaveBeenCalledTimes(2)
    expect(tmuxServiceMock.breakPaneToWindow).toHaveBeenCalledWith(
      fixture.sameProjectVisiblePane.paneId,
      `dmux-hidden-${fixture.sameProjectVisiblePane.id}`
    )
    expect(tmuxServiceMock.breakPaneToWindow).toHaveBeenCalledWith(
      fixture.otherProjectVisiblePane.paneId,
      `dmux-hidden-${fixture.otherProjectVisiblePane.id}`
    )
    expect(savePanes).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: fixture.sameProjectVisiblePane.id, hidden: true }),
        expect.objectContaining({ id: fixture.otherProjectVisiblePane.id, hidden: true }),
      ])
    )
    expect(loadPanes).toHaveBeenCalled()

    unmount()
  })

  it("dispatches show others through the bulk visibility mutation path", async () => {
    const fixture = createCanonicalFocusModeFixture()
    const panes = fixture.panes.map((pane) =>
      pane.id === fixture.selectedPane.id ? pane : { ...pane, hidden: true }
    )
    const savePanes = vi.fn(async () => {})
    const loadPanes = vi.fn(async () => {})
    const { unmount } = await triggerMoreAction("show-others", {
      panes,
      savePanes,
      loadPanes,
    })

    expect(tmuxServiceMock.joinPaneToTarget).toHaveBeenCalledTimes(4)
    expect(loadPanes).toHaveBeenCalled()

    unmount()
  })

  it("dispatches focus project through the project visibility mutation path", async () => {
    const savePanes = vi.fn(async () => {})
    const loadPanes = vi.fn(async () => {})
    const { fixture, unmount } = await triggerMoreAction("focus-project", {
      savePanes,
      loadPanes,
    })

    expect(tmuxServiceMock.joinPaneToTarget).toHaveBeenCalledWith(
      fixture.sameProjectHiddenPane.paneId,
      fixture.selectedPane.paneId
    )
    expect(tmuxServiceMock.breakPaneToWindow).toHaveBeenCalledWith(
      fixture.otherProjectVisiblePane.paneId,
      `dmux-hidden-${fixture.otherProjectVisiblePane.id}`
    )
    expect(loadPanes).toHaveBeenCalled()

    unmount()
  })

  it("dispatches show all through the project visibility mutation path", async () => {
    const fixture = createCanonicalFocusModeFixture()
    const panes = fixture.panes.map((pane) => {
      if (pane.id === fixture.sameProjectHiddenPane.id) {
        return { ...pane, hidden: false }
      }
      if (
        pane.id === fixture.otherProjectVisiblePane.id
        || pane.id === fixture.otherProjectHiddenPane.id
      ) {
        return { ...pane, hidden: true }
      }
      return pane
    })
    const savePanes = vi.fn(async () => {})
    const loadPanes = vi.fn(async () => {})
    const { unmount } = await triggerMoreAction("show-all", {
      panes,
      savePanes,
      loadPanes,
    })

    expect(tmuxServiceMock.joinPaneToTarget).toHaveBeenCalledTimes(2)
    expect(loadPanes).toHaveBeenCalled()

    unmount()
  })
})
