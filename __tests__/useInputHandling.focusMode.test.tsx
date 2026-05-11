import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render } from "ink-testing-library"
import { Text } from "ink"
import { useInputHandling } from "../src/hooks/useInputHandling.js"
import { TmuxService } from "../src/services/TmuxService.js"
import type { DmuxPane, NewPaneInput } from "../src/types.js"
import { enforceControlPaneSize } from "../src/utils/tmux.js"
import type { ProjectActionItem } from "../src/utils/projectActions.js"
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

async function withTmuxEnv(run: () => Promise<void>) {
  const previousTmux = process.env.TMUX
  process.env.TMUX = "/tmp/tmux-test/default,123,0"

  try {
    await run()
  } finally {
    if (previousTmux === undefined) {
      delete process.env.TMUX
    } else {
      process.env.TMUX = previousTmux
    }
  }
}

function pane(id: string, options: Partial<DmuxPane> = {}): DmuxPane {
  return {
    id,
    slug: `pane-${id}`,
    prompt: `prompt-${id}`,
    paneId: `%${id}`,
    projectRoot: "/repo",
    projectName: "repo",
    worktreePath: `/repo/.dmux/worktrees/pane-${id}`,
    ...options,
  }
}

function quietSettingsManager() {
  return {
    updateSetting: () => {},
    getEffectiveScope: () => "global" as const,
  }
}

function Harness({
  panes,
  selectedIndex = 0,
  presentationMode,
  popupManager,
  settingsManager,
  getSettingsManagerForProjectRoot = vi.fn(() => settingsManager),
  controlPaneId = "%0",
  setSelectedIndex = vi.fn(),
  setStatusMessage = vi.fn(),
  savePanes = vi.fn(async () => {}),
  loadPanes = vi.fn(async () => {}),
  getPanes = () => panes,
  handlePaneCreationWithAgent = vi.fn(async () => []),
  showInlineSettings = false,
  setShowInlineSettings = vi.fn(),
  inlineSettingsProjectRoot,
  setInlineSettingsProjectRoot = vi.fn(),
  projectActionItems = [],
  getActiveSurface,
  isControlPaneSelectionPending,
  clearControlPaneSelectionPending = vi.fn(),
  findCardInDirection = vi.fn(() => null),
}: {
  panes: DmuxPane[]
  selectedIndex?: number
  presentationMode: "grid" | "focus"
  popupManager: any
  settingsManager: any
  getSettingsManagerForProjectRoot?: (projectRoot: string) => any
  controlPaneId?: string
  setSelectedIndex?: (index: number) => void
  setStatusMessage?: (message: string) => void
  savePanes?: (panes: DmuxPane[]) => Promise<void>
  loadPanes?: () => Promise<void>
  getPanes?: () => DmuxPane[]
  handlePaneCreationWithAgent?: (paneInput: NewPaneInput, targetProjectRoot?: string) => Promise<unknown>
  showInlineSettings?: boolean
  setShowInlineSettings?: (value: boolean) => void
  inlineSettingsProjectRoot?: string
  setInlineSettingsProjectRoot?: (value: string | undefined) => void
  projectActionItems?: ProjectActionItem[]
  getActiveSurface?: () => "control" | "work" | "unknown"
  isControlPaneSelectionPending?: () => boolean
  clearControlPaneSelectionPending?: () => void
  findCardInDirection?: (
    currentIndex: number,
    direction: "up" | "down" | "left" | "right"
  ) => number | null
}) {
  useInputHandling({
    panes,
    selectedIndex,
    setSelectedIndex,
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
    showInlineSettings,
    setShowInlineSettings,
    inlineSettingsIndex: 0,
    setInlineSettingsIndex: vi.fn(),
    inlineSettingsMode: "list" as const,
    setInlineSettingsMode: vi.fn(),
    inlineSettingsEditingKey: undefined,
    setInlineSettingsEditingKey: vi.fn(),
    inlineSettingsEditingValueIndex: 0,
    setInlineSettingsEditingValueIndex: vi.fn(),
    inlineSettingsScopeIndex: 0,
    setInlineSettingsScopeIndex: vi.fn(),
    inlineSettingsProjectRoot,
    setInlineSettingsProjectRoot,
    resetInlineSettings: vi.fn(),
    projectSettings: {},
    saveSettings: vi.fn(),
    settingsManager,
    getSettingsManagerForProjectRoot,
    popupManager,
    actionSystem: {
      actionState: {},
      executeAction: vi.fn(),
      executeCallback: vi.fn(),
      clearDialog: vi.fn(),
      clearStatus: vi.fn(),
      setActionState: vi.fn(),
    },
    controlPaneId,
    getActiveSurface,
    isControlPaneSelectionPending,
    clearControlPaneSelectionPending,
    trackProjectActivity: vi.fn(async (work: () => unknown) => await work()),
    presentationMode,
    popupsSupported: true,
    setStatusMessage,
    copyNonGitFiles: vi.fn(),
    runCommandInternal: vi.fn(),
    handlePaneCreationWithAgent,
    handleCreateChildWorktree: vi.fn(async () => []),
    handleReopenWorktree: vi.fn(async () => null),
    setDevSourceFromPane: vi.fn(),
    savePanes,
    sidebarProjects: [{ projectRoot: "/repo", projectName: "repo" }],
    saveSidebarProjects: vi.fn(async (projects) => projects),
    loadPanes,
    getPanes,
    cleanExit: vi.fn(),
    availableAgents: ["claude"],
    panesFile: "/repo/.dmux/dmux.config.json",
    projectRoot: "/repo",
    projectActionItems,
    findCardInDirection,
  })

  return <Text>dmux</Text>
}

interface FakeTmuxState {
  selectedPaneId: string | undefined
  hiddenWindows: Map<string, string>
  joins: Array<{ paneId: string; targetPaneId: string }>
  splitPaneIds: string[]
  createdPanes: string[]
}

function createFakeTmuxState(): FakeTmuxState {
  return {
    selectedPaneId: undefined,
    hiddenWindows: new Map(),
    joins: [],
    splitPaneIds: [],
    createdPanes: [],
  }
}

describe("useInputHandling focus mode", () => {
  let tmuxState = createFakeTmuxState()
  const tmuxServiceMock = {
    selectPane: vi.fn(async (paneId: string) => {
      tmuxState.selectedPaneId = paneId
    }),
    normalizeClientKeyTableToRoot: vi.fn(async () => true),
    getActivePaneId: vi.fn(async () => "%0"),
    joinPaneToTarget: vi.fn(async (paneId: string, targetPaneId: string) => {
      tmuxState.joins.push({ paneId, targetPaneId })
    }),
    breakPaneToWindow: vi.fn(async (paneId: string, windowName: string) => {
      tmuxState.hiddenWindows.set(paneId, windowName)
    }),
    splitPane: vi.fn(async () => {
      const paneId = tmuxState.splitPaneIds.shift() || "%2"
      tmuxState.createdPanes.push(paneId)
      return paneId
    }),
    setPaneTitle: vi.fn(async () => {}),
  }

  beforeEach(() => {
    tmuxState = createFakeTmuxState()
    vi.clearAllMocks()
    vi.mocked(getCurrentTmuxSessionName).mockReturnValue(null)
    vi.mocked(drainRemotePaneActions).mockResolvedValue([])
    vi.spyOn(TmuxService, "getInstance").mockReturnValue(
      tmuxServiceMock as unknown as TmuxService
    )
  })

  const clearFocusMocks = () => {
    tmuxServiceMock.selectPane.mockClear()
    tmuxServiceMock.normalizeClientKeyTableToRoot.mockClear()
  }

  const expectSidebarFocusRestored = () => {
    expect(tmuxServiceMock.selectPane).toHaveBeenLastCalledWith("%0")
    expect(tmuxState.selectedPaneId).toBe("%0")
    expect(tmuxServiceMock.normalizeClientKeyTableToRoot).toHaveBeenCalled()
  }

  it("enters focus mode by isolating the selected pane and returning focus to the sidebar", async () => {
    const popupManager = {
      launchSettingsPopup: vi.fn(async () => ({
        kind: "completed" as const,
        updates: [{
          key: "presentationMode",
          value: "focus",
          scope: "global" as const,
        }],
      })),
    }
    const settingsManager = {
      updateSetting: vi.fn(),
      getEffectiveScope: vi.fn(() => "global"),
    }
    const savePanes = vi.fn(async () => {})

    const { stdin, unmount } = render(
      <Harness
        panes={[pane("1"), pane("2")]}
        presentationMode="grid"
        popupManager={popupManager}
        settingsManager={settingsManager}
        savePanes={savePanes}
      />
    )

    await sleep(20)
    stdin.write("s")
    await sleep(80)

    expect(settingsManager.updateSetting).toHaveBeenCalledWith(
      "presentationMode",
      "focus",
      "global"
    )
    expect(tmuxServiceMock.breakPaneToWindow).toHaveBeenCalledWith(
      "%2",
      "dmux-hidden-2"
    )
    expect(savePanes).toHaveBeenCalledWith([
      expect.objectContaining({ id: "1", hidden: false }),
      expect.objectContaining({ id: "2", hidden: true }),
    ])
    expect(tmuxServiceMock.selectPane).toHaveBeenCalledWith("%0")

    unmount()
  })

  it("does not open inline settings when the settings popup is cancelled", async () => {
    const setShowInlineSettings = vi.fn()
    const popupManager = {
      launchSettingsPopup: vi.fn(async () => ({
        kind: "cancelled" as const,
      })),
    }

    const { stdin, unmount } = render(
      <Harness
        panes={[pane("1")]}
        presentationMode="grid"
        popupManager={popupManager}
        settingsManager={{
          updateSetting: vi.fn(),
          getEffectiveScope: vi.fn(() => "global"),
        }}
        setShowInlineSettings={setShowInlineSettings}
      />
    )

    await sleep(20)
    stdin.write("s")
    await sleep(40)

    expect(setShowInlineSettings).not.toHaveBeenCalled()

    unmount()
  })

  it("falls back to inline settings when popup launch is unavailable", async () => {
    const setShowInlineSettings = vi.fn()
    const popupManager = {
      launchSettingsPopup: vi.fn(async () => ({
        kind: "unavailable" as const,
        reason: "error" as const,
      })),
    }

    const { stdin, unmount } = render(
      <Harness
        panes={[pane("1")]}
        presentationMode="grid"
        popupManager={popupManager}
        settingsManager={{
          updateSetting: vi.fn(),
          getEffectiveScope: vi.fn(() => "global"),
        }}
        setShowInlineSettings={setShowInlineSettings}
      />
    )

    await sleep(20)
    stdin.write("s")
    await sleep(40)

    expect(setShowInlineSettings).toHaveBeenCalledWith(true)

    unmount()
  })

  it("uses the latest active project root when remote settings are opened from an unmanaged pane", async () => {
    vi.mocked(getCurrentTmuxSessionName).mockReturnValue("dmux-test")
    vi.mocked(drainRemotePaneActions)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ shortcut: "m", targetPaneId: "%999" }])

    const popupManager = {
      launchHooksPopup: vi.fn(async () => null),
      launchSettingsPopup: vi.fn(async () => ({
        kind: "cancelled" as const,
      })),
    }

    const renderResult = render(
      <Harness
        panes={[pane("1")]}
        selectedIndex={1}
        presentationMode="grid"
        popupManager={popupManager}
        settingsManager={{
          updateSetting: vi.fn(),
          getEffectiveScope: vi.fn(() => "global"),
        }}
        projectActionItems={[
          { index: 1, projectRoot: "/repo-a", projectName: "repo-a", kind: "new-agent", hotkey: "n" },
        ]}
      />
    )

    await sleep(40)

    renderResult.rerender(
      <Harness
        panes={[pane("1")]}
        selectedIndex={1}
        presentationMode="grid"
        popupManager={popupManager}
        settingsManager={{
          updateSetting: vi.fn(),
          getEffectiveScope: vi.fn(() => "global"),
        }}
        projectActionItems={[
          { index: 1, projectRoot: "/repo-b", projectName: "repo-b", kind: "new-agent", hotkey: "n" },
        ]}
      />
    )

    await sleep(20)
    process.emit("dmux-external-command-signal" as any)
    await sleep(80)

    expect(popupManager.launchSettingsPopup).toHaveBeenLastCalledWith(
      expect.any(Function),
      "/repo-b"
    )

    renderResult.unmount()
  })

  it("applies non-session project settings updates to the selected sidebar project root", async () => {
    vi.mocked(getCurrentTmuxSessionName).mockReturnValue("dmux-test")
    vi.mocked(drainRemotePaneActions)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ shortcut: "m", targetPaneId: "%999" }])

    const popupManager = {
      launchHooksPopup: vi.fn(async () => null),
      launchSettingsPopup: vi.fn(async () => ({
        kind: "completed" as const,
        updates: [{
          key: "showFooterTips",
          value: false,
          scope: "project" as const,
        }],
      })),
    }
    const sessionSettingsManager = {
      updateSetting: vi.fn(),
      getEffectiveScope: vi.fn(() => "global"),
      getSettings: vi.fn(() => ({ showFooterTips: true })),
    }
    const repoBSettingsManager = {
      updateSetting: vi.fn(),
      getSettings: vi.fn(() => ({ showFooterTips: true })),
    }
    const getSettingsManagerForProjectRoot = vi.fn((projectRoot: string) =>
      projectRoot === "/repo-b" ? repoBSettingsManager : sessionSettingsManager
    )

    const { unmount } = render(
      <Harness
        panes={[pane("1")]}
        selectedIndex={1}
        presentationMode="grid"
        popupManager={popupManager}
        settingsManager={sessionSettingsManager}
        getSettingsManagerForProjectRoot={getSettingsManagerForProjectRoot}
        projectActionItems={[
          { index: 1, projectRoot: "/repo-b", projectName: "repo-b", kind: "new-agent", hotkey: "n" },
        ]}
      />
    )

    await sleep(40)
    process.emit("dmux-external-command-signal" as any)
    await sleep(80)

    expect(repoBSettingsManager.updateSetting).toHaveBeenCalledWith(
      "showFooterTips",
      false,
      "project"
    )
    expect(sessionSettingsManager.updateSetting).not.toHaveBeenCalled()

    unmount()
  })

  it("targets the selected sidebar project when falling back to inline settings", async () => {
    vi.mocked(getCurrentTmuxSessionName).mockReturnValue("dmux-test")
    vi.mocked(drainRemotePaneActions)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ shortcut: "m", targetPaneId: "%999" }])

    const setShowInlineSettings = vi.fn()
    const setInlineSettingsProjectRoot = vi.fn()
    const popupManager = {
      launchHooksPopup: vi.fn(async () => null),
      launchSettingsPopup: vi.fn(async () => ({
        kind: "unavailable" as const,
        reason: "unsupported" as const,
      })),
    }

    const { unmount } = render(
      <Harness
        panes={[pane("1")]}
        selectedIndex={1}
        presentationMode="grid"
        popupManager={popupManager}
        settingsManager={{
          updateSetting: vi.fn(),
          getEffectiveScope: vi.fn(() => "global"),
          getSettings: vi.fn(() => ({})),
        }}
        setShowInlineSettings={setShowInlineSettings}
        setInlineSettingsProjectRoot={setInlineSettingsProjectRoot}
        projectActionItems={[
          { index: 1, projectRoot: "/repo-b", projectName: "repo-b", kind: "new-agent", hotkey: "n" },
        ]}
      />
    )

    await sleep(40)
    process.emit("dmux-external-command-signal" as any)
    await sleep(80)

    expect(setInlineSettingsProjectRoot).toHaveBeenCalledWith("/repo-b")
    expect(setShowInlineSettings).toHaveBeenCalledWith(true)

    unmount()
  })

  it("persists non-session project presentation mode without live-applying it to the current session", async () => {
    vi.mocked(getCurrentTmuxSessionName).mockReturnValue("dmux-test")
    vi.mocked(drainRemotePaneActions)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ shortcut: "m", targetPaneId: "%999" }])

    const popupManager = {
      launchHooksPopup: vi.fn(async () => null),
      launchSettingsPopup: vi.fn(async () => ({
        kind: "completed" as const,
        updates: [{
          key: "presentationMode",
          value: "focus",
          scope: "project" as const,
        }],
      })),
    }
    const sessionSettingsManager = {
      updateSetting: vi.fn(),
      getEffectiveScope: vi.fn(() => "global"),
      getSettings: vi.fn(() => ({ presentationMode: "grid" })),
    }
    const repoBSettingsManager = {
      updateSetting: vi.fn(),
      getSettings: vi.fn(() => ({ presentationMode: "grid" })),
    }
    const getSettingsManagerForProjectRoot = vi.fn((projectRoot: string) =>
      projectRoot === "/repo-b" ? repoBSettingsManager : sessionSettingsManager
    )
    const savePanes = vi.fn(async () => {})

    const { unmount } = render(
      <Harness
        panes={[pane("1"), pane("2")]}
        selectedIndex={2}
        presentationMode="grid"
        popupManager={popupManager}
        settingsManager={sessionSettingsManager}
        getSettingsManagerForProjectRoot={getSettingsManagerForProjectRoot}
        savePanes={savePanes}
        projectActionItems={[
          { index: 2, projectRoot: "/repo-b", projectName: "repo-b", kind: "new-agent", hotkey: "n" },
        ]}
      />
    )

    await sleep(40)
    process.emit("dmux-external-command-signal" as any)
    await sleep(80)

    expect(repoBSettingsManager.updateSetting).toHaveBeenCalledWith(
      "presentationMode",
      "focus",
      "project"
    )
    expect(sessionSettingsManager.updateSetting).not.toHaveBeenCalled()
    expect(tmuxServiceMock.breakPaneToWindow).not.toHaveBeenCalled()
    expect(savePanes).not.toHaveBeenCalled()

    unmount()
  })

  it("blocks remote queued actions while inline settings are open", async () => {
    vi.mocked(getCurrentTmuxSessionName).mockReturnValue("dmux-test")
    vi.mocked(drainRemotePaneActions).mockResolvedValue([
      { shortcut: "m", targetPaneId: "%999" },
    ])

    const popupManager = {
      launchSettingsPopup: vi.fn(),
    }
    const setStatusMessage = vi.fn()

    const { unmount } = render(
      <Harness
        panes={[pane("1")]}
        presentationMode="grid"
        popupManager={popupManager}
        settingsManager={{
          updateSetting: vi.fn(),
          getEffectiveScope: vi.fn(() => "global"),
        }}
        showInlineSettings={true}
        setStatusMessage={setStatusMessage}
      />
    )

    await sleep(80)

    expect(popupManager.launchSettingsPopup).not.toHaveBeenCalled()
    expect(setStatusMessage).toHaveBeenCalledWith(
      "dmux is busy; ignored remote pane action m"
    )

    unmount()
  })

  it("refreshes layout once when remote settings update pane width bounds", async () => {
    vi.mocked(getCurrentTmuxSessionName).mockReturnValue("dmux-test")
    vi.mocked(drainRemotePaneActions).mockResolvedValue([
      { shortcut: "m", targetPaneId: "%999" },
    ])

    const popupManager = {
      launchHooksPopup: vi.fn(async () => null),
      launchSettingsPopup: vi.fn(async () => ({
        kind: "completed" as const,
        updates: [{
          key: "minPaneWidth",
          value: 72,
          scope: "global" as const,
        }],
      })),
    }
    const settingsManager = {
      updateSetting: vi.fn(),
      getEffectiveScope: vi.fn(() => "global"),
    }

    const { unmount } = render(
      <Harness
        panes={[pane("1")]}
        presentationMode="grid"
        popupManager={popupManager}
        settingsManager={settingsManager}
      />
    )

    await sleep(320)

    expect(settingsManager.updateSetting).toHaveBeenCalledWith(
      "minPaneWidth",
      72,
      "global"
    )
    expect(enforceControlPaneSize).toHaveBeenCalledTimes(1)
    expect(enforceControlPaneSize).toHaveBeenCalledWith(
      "%0",
      expect.any(Number),
      { forceLayout: true }
    )

    unmount()
  })

  it("does not persist presentation mode when the live tmux apply fails", async () => {
    tmuxServiceMock.breakPaneToWindow.mockRejectedValueOnce(new Error("break-pane failed"))

    const popupManager = {
      launchSettingsPopup: vi.fn(async () => ({
        kind: "completed" as const,
        updates: [{
          key: "presentationMode",
          value: "focus",
          scope: "global" as const,
        }],
      })),
    }
    const settingsManager = {
      updateSetting: vi.fn(),
      getEffectiveScope: vi.fn(() => "global"),
      getSettings: vi.fn(() => ({ presentationMode: "grid" })),
    }
    const setStatusMessage = vi.fn()

    const { stdin, unmount } = render(
      <Harness
        panes={[pane("1"), pane("2")]}
        presentationMode="grid"
        popupManager={popupManager}
        settingsManager={settingsManager}
        setStatusMessage={setStatusMessage}
      />
    )

    await sleep(20)
    stdin.write("s")
    await sleep(80)

    expect(settingsManager.updateSetting).not.toHaveBeenCalled()
    expect(setStatusMessage).toHaveBeenCalledWith(
      "Failed to save setting: break-pane failed"
    )

    unmount()
  })

  it("restores the previous pane visibility snapshot when presentation mode persistence fails", async () => {
    const popupManager = {
      launchSettingsPopup: vi.fn(async () => ({
        kind: "completed" as const,
        updates: [{
          key: "presentationMode",
          value: "focus",
          scope: "global" as const,
        }],
      })),
    }
    const settingsManager = {
      updateSetting: vi.fn(() => {
        throw new Error("disk full")
      }),
      getEffectiveScope: vi.fn(() => "global"),
      getSettings: vi.fn(() => ({ presentationMode: "grid" })),
    }
    const savePanes = vi.fn(async () => {})
    const loadPanes = vi.fn(async () => {})
    const setStatusMessage = vi.fn()

    const { stdin, unmount } = render(
      <Harness
        panes={[pane("1"), pane("2")]}
        presentationMode="grid"
        popupManager={popupManager}
        settingsManager={settingsManager}
        savePanes={savePanes}
        loadPanes={loadPanes}
        setStatusMessage={setStatusMessage}
      />
    )

    await sleep(20)
    stdin.write("s")
    await sleep(100)

    expect(tmuxServiceMock.breakPaneToWindow).toHaveBeenCalledWith("%2", "dmux-hidden-2")
    expect(tmuxServiceMock.joinPaneToTarget).toHaveBeenCalledWith("%2", "%1")
    expect(savePanes).toHaveBeenNthCalledWith(1, [
      expect.objectContaining({ id: "1", hidden: false }),
      expect.objectContaining({ id: "2", hidden: true }),
    ])
    expect(savePanes.mock.calls[1]?.[0]).toEqual([
      expect.objectContaining({ id: "1" }),
      expect.objectContaining({ id: "2" }),
    ])
    expect((savePanes.mock.calls[1]?.[0] as DmuxPane[]).every((pane) => pane.hidden !== true)).toBe(true)
    expect(setStatusMessage).toHaveBeenCalledWith("Failed to save setting: disk full")

    unmount()
  })

  it("activates the selected pane in focus mode without zoom semantics", async () => {
    const { stdin, unmount } = render(
      <Harness
        panes={[pane("1", { hidden: true }), pane("2")]}
        selectedIndex={1}
        presentationMode="focus"
        popupManager={{}}
        settingsManager={{
          updateSetting: vi.fn(),
          getEffectiveScope: vi.fn(() => "global"),
        }}
      />
    )

    await sleep(40)
    tmuxServiceMock.selectPane.mockClear()

    stdin.write("j")
    await sleep(40)

    expect(tmuxServiceMock.selectPane).toHaveBeenCalledWith("%2")

    unmount()
  })

  it("shows a visible grid pane on Enter without leaving the sidebar", async () => {
    const popupManager = {
      launchKebabMenuPopup: vi.fn(),
    }
    const setSelectedIndex = vi.fn()

    const { stdin, unmount } = render(
      <Harness
        panes={[pane("1"), pane("2")]}
        selectedIndex={1}
        presentationMode="grid"
        popupManager={popupManager}
        settingsManager={quietSettingsManager()}
        setSelectedIndex={setSelectedIndex}
      />
    )

    await sleep(20)
    clearFocusMocks()

    stdin.write("\r")
    await sleep(80)

    expect(popupManager.launchKebabMenuPopup).not.toHaveBeenCalled()
    expect(setSelectedIndex).toHaveBeenCalledWith(1)
    expect(tmuxServiceMock.selectPane).not.toHaveBeenCalledWith("%2")
    expectSidebarFocusRestored()

    unmount()
  })

  it("reveals a hidden grid pane on Enter while keeping sidebar focus", async () => {
    let currentPanes = [pane("1", { hidden: true }), pane("2")]
    const popupManager = {
      launchKebabMenuPopup: vi.fn(),
    }
    const setSelectedIndex = vi.fn()
    const savePanes = vi.fn(async (updatedPanes: DmuxPane[]) => {
      currentPanes = updatedPanes.map((updatedPane) => ({ ...updatedPane }))
    })
    const loadPanes = vi.fn(async () => {})

    const { stdin, unmount } = render(
      <Harness
        panes={currentPanes}
        selectedIndex={0}
        presentationMode="grid"
        popupManager={popupManager}
        settingsManager={quietSettingsManager()}
        setSelectedIndex={setSelectedIndex}
        savePanes={savePanes}
        loadPanes={loadPanes}
        getPanes={() => currentPanes}
      />
    )

    await sleep(20)
    clearFocusMocks()

    stdin.write("\r")
    await sleep(80)

    expect(popupManager.launchKebabMenuPopup).not.toHaveBeenCalled()
    expect(tmuxServiceMock.joinPaneToTarget).toHaveBeenCalledWith("%1", "%2")
    expect(savePanes).toHaveBeenCalledWith([
      expect.objectContaining({ id: "1", hidden: false }),
      expect.objectContaining({ id: "2" }),
    ])
    expect(loadPanes).toHaveBeenCalled()
    expect(setSelectedIndex).toHaveBeenCalledWith(0)
    expect(tmuxServiceMock.selectPane).not.toHaveBeenCalledWith("%1")
    expectSidebarFocusRestored()

    unmount()
  })

  it("does not steal focus when Enter presents a pane in focus mode", async () => {
    const popupManager = {
      launchKebabMenuPopup: vi.fn(),
    }

    const { stdin, unmount } = render(
      <Harness
        panes={[pane("1", { hidden: true }), pane("2")]}
        selectedIndex={1}
        presentationMode="focus"
        popupManager={popupManager}
        settingsManager={quietSettingsManager()}
      />
    )

    await sleep(40)
    clearFocusMocks()

    stdin.write("\r")
    await sleep(80)

    expect(popupManager.launchKebabMenuPopup).not.toHaveBeenCalled()
    expect(tmuxServiceMock.selectPane).not.toHaveBeenCalledWith("%2")
    expectSidebarFocusRestored()

    unmount()
  })

  it("keeps m as the explicit pane menu shortcut", async () => {
    const popupManager = {
      launchKebabMenuPopup: vi.fn(async () => null),
    }

    const { stdin, unmount } = render(
      <Harness
        panes={[pane("1")]}
        selectedIndex={0}
        presentationMode="grid"
        popupManager={popupManager}
        settingsManager={quietSettingsManager()}
      />
    )

    await sleep(20)
    stdin.write("m")
    await sleep(80)

    expect(popupManager.launchKebabMenuPopup).toHaveBeenCalledWith(
      expect.objectContaining({ id: "1" }),
      [expect.objectContaining({ id: "1" })],
      {}
    )

    unmount()
  })

  it("activates a newly created terminal in focus mode by isolating it", async () => {
    let currentPanes = [pane("1"), pane("2")]
    let rerender: ReturnType<typeof render>["rerender"]
    const savePanes = async (nextPanes: DmuxPane[]) => {
      currentPanes = nextPanes
      rerender(
        <Harness
          panes={currentPanes}
          presentationMode="focus"
          popupManager={{}}
          settingsManager={quietSettingsManager()}
          savePanes={savePanes}
        />
      )
    }

    tmuxState.splitPaneIds.push("%9")

    const rendered = render(
      <Harness
        panes={currentPanes}
        presentationMode="focus"
        popupManager={{}}
        settingsManager={quietSettingsManager()}
        savePanes={savePanes}
      />
    )
    rerender = rendered.rerender

    await sleep(20)
    rendered.stdin.write("t")
    await sleep(500)

    expect(tmuxState.selectedPaneId).toBe("%9")
    expect(tmuxState.hiddenWindows).toEqual(new Map([
      ["%1", "dmux-hidden-1"],
      ["%2", "dmux-hidden-2"],
    ]))

    rendered.unmount()
  })

  it("activates a newly created terminal in grid mode without hiding visible panes", async () => {
    let currentPanes = [pane("1"), pane("2")]
    let rerender: ReturnType<typeof render>["rerender"]
    const savePanes = async (nextPanes: DmuxPane[]) => {
      currentPanes = nextPanes
      rerender(
        <Harness
          panes={currentPanes}
          presentationMode="grid"
          popupManager={{}}
          settingsManager={quietSettingsManager()}
          savePanes={savePanes}
        />
      )
    }

    tmuxState.splitPaneIds.push("%9")

    const rendered = render(
      <Harness
        panes={currentPanes}
        presentationMode="grid"
        popupManager={{}}
        settingsManager={quietSettingsManager()}
        savePanes={savePanes}
      />
    )
    rerender = rendered.rerender

    await sleep(20)
    rendered.stdin.write("t")
    await sleep(500)

    expect(tmuxState.selectedPaneId).toBe("%9")
    expect(tmuxState.hiddenWindows.size).toBe(0)

    rendered.unmount()
  })

  it("reuses a hidden file browser in focus mode instead of creating a duplicate", async () => {
    const workPane = pane("1")
    const browserPane = pane("3", {
      hidden: true,
      paneId: "%3",
      type: "shell",
      shellType: "fb",
      browserPath: workPane.worktreePath,
    })
    let savedPanes: DmuxPane[] = []
    const savePanes = async (nextPanes: DmuxPane[]) => {
      savedPanes = nextPanes
    }

    const { stdin, unmount } = render(
      <Harness
        panes={[workPane, browserPane]}
        selectedIndex={0}
        presentationMode="focus"
        popupManager={{}}
        settingsManager={quietSettingsManager()}
        savePanes={savePanes}
      />
    )

    await sleep(20)
    stdin.write("f")
    await sleep(80)

    expect(tmuxState.createdPanes).toEqual([])
    expect(tmuxState.joins).toEqual([{ paneId: "%3", targetPaneId: "%1" }])
    expect(tmuxState.hiddenWindows).toEqual(new Map([
      ["%1", "dmux-hidden-1"],
    ]))
    expect(tmuxState.selectedPaneId).toBe("%3")
    expect(savedPanes).toEqual([
      expect.objectContaining({ id: "1", hidden: true }),
      expect.objectContaining({ id: "3", hidden: false }),
    ])

    unmount()
  })

  it("reuses a hidden file browser in grid mode without hiding visible panes", async () => {
    const workPane = pane("1")
    const otherPane = pane("2")
    const browserPane = pane("3", {
      hidden: true,
      paneId: "%3",
      type: "shell",
      shellType: "fb",
      browserPath: workPane.worktreePath,
    })
    let savedPanes: DmuxPane[] = []
    const savePanes = async (nextPanes: DmuxPane[]) => {
      savedPanes = nextPanes
    }

    const { stdin, unmount } = render(
      <Harness
        panes={[workPane, otherPane, browserPane]}
        selectedIndex={0}
        presentationMode="grid"
        popupManager={{}}
        settingsManager={quietSettingsManager()}
        savePanes={savePanes}
      />
    )

    await sleep(20)
    stdin.write("f")
    await sleep(80)

    expect(tmuxState.createdPanes).toEqual([])
    expect(tmuxState.joins).toEqual([{ paneId: "%3", targetPaneId: "%1" }])
    expect(tmuxState.hiddenWindows.size).toBe(0)
    expect(tmuxState.selectedPaneId).toBe("%3")
    expect(savedPanes.find((pane) => pane.id === "1")?.hidden).not.toBe(true)
    expect(savedPanes.find((pane) => pane.id === "2")?.hidden).not.toBe(true)
    expect(savedPanes.find((pane) => pane.id === "3")?.hidden).toBe(false)

    unmount()
  })

  it("selects a rebound pane id after reloading a shown hidden pane", async () => {
    const workPane = pane("1")
    const browserPane = pane("3", {
      hidden: true,
      paneId: "%old",
      type: "shell",
      shellType: "fb",
      browserPath: workPane.worktreePath,
    })
    let currentPanes = [workPane, browserPane]
    let rerender: ReturnType<typeof render>["rerender"]
    const savePanes = async (nextPanes: DmuxPane[]) => {
      currentPanes = nextPanes
    }
    const loadPanes = async () => {
      currentPanes = currentPanes.map((entry) =>
        entry.id === browserPane.id
          ? { ...entry, paneId: "%new", hidden: false }
          : entry
      )
      rerender(
        <Harness
          panes={currentPanes}
          selectedIndex={0}
          presentationMode="grid"
          popupManager={{}}
          settingsManager={quietSettingsManager()}
          savePanes={savePanes}
          loadPanes={loadPanes}
          getPanes={() => currentPanes}
        />
      )
    }

    const rendered = render(
      <Harness
        panes={currentPanes}
        selectedIndex={0}
        presentationMode="grid"
        popupManager={{}}
        settingsManager={quietSettingsManager()}
        savePanes={savePanes}
        loadPanes={loadPanes}
        getPanes={() => currentPanes}
      />
    )
    rerender = rendered.rerender

    await sleep(20)
    rendered.stdin.write("f")
    await sleep(80)

    expect(tmuxState.joins).toEqual([{ paneId: "%old", targetPaneId: "%1" }])
    expect(tmuxState.selectedPaneId).toBe("%new")

    rendered.unmount()
  })

  it("falls back to another visible pane instead of re-showing a hidden selection", async () => {
    const setSelectedIndex = vi.fn()

    const { unmount } = render(
      <Harness
        panes={[pane("1", { hidden: true }), pane("2")]}
        selectedIndex={0}
        presentationMode="focus"
        popupManager={{}}
        settingsManager={{
          updateSetting: vi.fn(),
          getEffectiveScope: vi.fn(() => "global"),
        }}
        setSelectedIndex={setSelectedIndex}
      />
    )

    await sleep(60)

    expect(setSelectedIndex).toHaveBeenCalledWith(1)
    expect(
      tmuxServiceMock.joinPaneToTarget.mock.calls.some(
        ([paneId]) => paneId === "%1"
      )
    ).toBe(false)

    unmount()
  })

  it("keeps the selected hidden pane hidden when focus mode has no visible panes", async () => {
    const savePanes = vi.fn(async () => {})
    const setSelectedIndex = vi.fn()

    const { unmount } = render(
      <Harness
        panes={[pane("1", { hidden: true }), pane("2", { hidden: true })]}
        selectedIndex={1}
        presentationMode="focus"
        popupManager={{}}
        settingsManager={{
          updateSetting: vi.fn(),
          getEffectiveScope: vi.fn(() => "global"),
        }}
        savePanes={savePanes}
        setSelectedIndex={setSelectedIndex}
      />
    )

    await sleep(60)

    expect(tmuxServiceMock.joinPaneToTarget).not.toHaveBeenCalled()
    expect(setSelectedIndex).not.toHaveBeenCalled()
    expect(savePanes).not.toHaveBeenCalled()

    unmount()
  })

  it("leaves all panes hidden after hiding the last visible pane in focus mode", async () => {
    let currentPanes = [pane("1"), pane("2", { hidden: true })]
    let currentSelectedIndex = 0

    const savePanes = vi.fn(async (updatedPanes: DmuxPane[]) => {
      currentPanes = updatedPanes.map((pane) => ({ ...pane }))
    })
    const setSelectedIndex = vi.fn((index: number) => {
      currentSelectedIndex = index
    })

    const renderResult = render(
      <Harness
        panes={currentPanes}
        selectedIndex={currentSelectedIndex}
        presentationMode="focus"
        popupManager={{}}
        settingsManager={{
          updateSetting: vi.fn(),
          getEffectiveScope: vi.fn(() => "global"),
        }}
        savePanes={savePanes}
        setSelectedIndex={setSelectedIndex}
      />
    )

    await sleep(40)
    renderResult.stdin.write("h")
    await sleep(80)

    renderResult.rerender(
      <Harness
        panes={currentPanes}
        selectedIndex={currentSelectedIndex}
        presentationMode="focus"
        popupManager={{}}
        settingsManager={{
          updateSetting: vi.fn(),
          getEffectiveScope: vi.fn(() => "global"),
        }}
        savePanes={savePanes}
        setSelectedIndex={setSelectedIndex}
      />
    )

    await sleep(80)

    expect(setSelectedIndex).not.toHaveBeenCalled()
    expect(tmuxServiceMock.selectPane).toHaveBeenCalledWith("%0")
    expect(tmuxServiceMock.normalizeClientKeyTableToRoot).toHaveBeenCalled()
    expect(tmuxServiceMock.joinPaneToTarget).not.toHaveBeenCalled()
    expect(currentPanes).toEqual([
      expect.objectContaining({ id: "1", hidden: true }),
      expect.objectContaining({ id: "2", hidden: true }),
    ])

    renderResult.unmount()
  })

  it("keeps sidebar focus after hiding other panes from the sidebar", async () => {
    const savePanes = vi.fn(async () => {})

    const { stdin, unmount } = render(
      <Harness
        panes={[pane("1"), pane("2")]}
        selectedIndex={0}
        presentationMode="grid"
        popupManager={{}}
        settingsManager={quietSettingsManager()}
        savePanes={savePanes}
      />
    )

    await sleep(20)
    clearFocusMocks()

    stdin.write("H")
    await sleep(80)

    expect(tmuxServiceMock.breakPaneToWindow).toHaveBeenCalledWith("%2", "dmux-hidden-2")
    expect(savePanes).toHaveBeenCalledWith([
      expect.objectContaining({ id: "1" }),
      expect.objectContaining({ id: "2", hidden: true }),
    ])
    expectSidebarFocusRestored()

    unmount()
  })

  it("keeps sidebar focus after focusing a project from the sidebar", async () => {
    const savePanes = vi.fn(async () => {})
    const repoPane = pane("1", { projectRoot: "/repo", projectName: "repo" })
    const otherPane = pane("2", {
      projectRoot: "/repo-b",
      projectName: "repo-b",
      worktreePath: "/repo-b/.dmux/worktrees/pane-2",
    })

    const { stdin, unmount } = render(
      <Harness
        panes={[repoPane, otherPane]}
        selectedIndex={0}
        presentationMode="grid"
        popupManager={{}}
        settingsManager={quietSettingsManager()}
        savePanes={savePanes}
      />
    )

    await sleep(20)
    clearFocusMocks()

    stdin.write("P")
    await sleep(80)

    expect(tmuxServiceMock.breakPaneToWindow).toHaveBeenCalledWith("%2", "dmux-hidden-2")
    expect(savePanes).toHaveBeenCalledWith([
      expect.objectContaining({ id: "1" }),
      expect.objectContaining({ id: "2", hidden: true }),
    ])
    expectSidebarFocusRestored()

    unmount()
  })

  it("keeps a newly created pane active after the panes list reloads in focus mode", async () => {
    const popupManager = {
      launchNewPanePopup: vi.fn(async () => "Build the feature"),
    }
    const settingsManager = {
      updateSetting: vi.fn(),
      getEffectiveScope: vi.fn(() => "global"),
    }
    const savePanes = vi.fn(async () => {})
    const loadPanes = vi.fn(async () => {})
    const setSelectedIndex = vi.fn()
    const newPane = pane("2")
    const handlePaneCreationWithAgent = vi.fn(async () => [newPane])

    const renderResult = render(
      <Harness
        panes={[pane("1")]}
        presentationMode="focus"
        popupManager={popupManager}
        settingsManager={settingsManager}
        savePanes={savePanes}
        loadPanes={loadPanes}
        setSelectedIndex={setSelectedIndex}
        handlePaneCreationWithAgent={handlePaneCreationWithAgent}
      />
    )

    await sleep(20)
    renderResult.stdin.write("n")
    await sleep(80)

    expect(handlePaneCreationWithAgent).toHaveBeenCalledWith("Build the feature", "/repo")

    tmuxServiceMock.breakPaneToWindow.mockClear()
    tmuxServiceMock.selectPane.mockClear()
    savePanes.mockClear()
    setSelectedIndex.mockClear()

    renderResult.rerender(
      <Harness
        panes={[pane("1"), newPane]}
        presentationMode="focus"
        popupManager={popupManager}
        settingsManager={settingsManager}
        savePanes={savePanes}
        loadPanes={loadPanes}
        setSelectedIndex={setSelectedIndex}
        handlePaneCreationWithAgent={handlePaneCreationWithAgent}
      />
    )

    await sleep(80)

    expect(setSelectedIndex).toHaveBeenCalledWith(1)
    expect(tmuxServiceMock.breakPaneToWindow).toHaveBeenCalledWith("%1", "dmux-hidden-1")
    expect(tmuxServiceMock.selectPane).toHaveBeenCalledWith("%2")
    expect(savePanes).toHaveBeenCalledWith([
      expect.objectContaining({ id: "1", hidden: true }),
      expect.objectContaining({ id: "2", hidden: false }),
    ])

    renderResult.unmount()
  })

  it("uses Enter on a selected project action instead of opening a stale pane menu", async () => {
    const popupManager = {
      launchNewPanePopup: vi.fn(async () => ({ prompt: "from action" })),
      launchKebabMenuPopup: vi.fn(),
    }
    const handlePaneCreationWithAgent = vi.fn(async () => [])

    const { stdin, unmount } = render(
      <Harness
        panes={[pane("1")]}
        selectedIndex={1}
        presentationMode="grid"
        popupManager={popupManager}
        settingsManager={{
          updateSetting: vi.fn(),
          getEffectiveScope: vi.fn(() => "global"),
        }}
        handlePaneCreationWithAgent={handlePaneCreationWithAgent}
        projectActionItems={[
          { index: 1, projectRoot: "/repo-b", projectName: "repo-b", kind: "new-agent", hotkey: "n" },
        ]}
      />
    )

    await sleep(20)
    stdin.write("\r")
    await sleep(80)

    expect(popupManager.launchNewPanePopup).toHaveBeenCalledWith("/repo-b")
    expect(handlePaneCreationWithAgent).toHaveBeenCalledWith({ prompt: "from action" }, "/repo-b")
    expect(popupManager.launchKebabMenuPopup).not.toHaveBeenCalled()

    unmount()
  })

  it("re-resolves stale pane selection before Enter acts from the control pane", async () => {
    const popupManager = {
      launchNewPanePopup: vi.fn(async () => ({ prompt: "from control focus" })),
      launchKebabMenuPopup: vi.fn(),
    }
    const handlePaneCreationWithAgent = vi.fn(async () => [])
    const setSelectedIndex = vi.fn()

    await withTmuxEnv(async () => {
      const { stdin, unmount } = render(
        <Harness
          panes={[pane("1")]}
          selectedIndex={0}
          presentationMode="grid"
          popupManager={popupManager}
          settingsManager={{
            updateSetting: vi.fn(),
            getEffectiveScope: vi.fn(() => "global"),
          }}
          setSelectedIndex={setSelectedIndex}
          handlePaneCreationWithAgent={handlePaneCreationWithAgent}
          getActiveSurface={() => "work"}
          projectActionItems={[
            { index: 1, projectRoot: "/repo", projectName: "repo", kind: "new-agent", hotkey: "n" },
          ]}
        />
      )

      await sleep(20)
      stdin.write("\r")
      await sleep(80)

      expect(tmuxServiceMock.getActivePaneId).toHaveBeenCalledTimes(1)
      expect(setSelectedIndex).toHaveBeenCalledWith(1)
      expect(popupManager.launchNewPanePopup).toHaveBeenCalledWith("/repo")
      expect(handlePaneCreationWithAgent).toHaveBeenCalledWith(
        { prompt: "from control focus" },
        "/repo"
      )
      expect(popupManager.launchKebabMenuPopup).not.toHaveBeenCalled()

      unmount()
    })
  })

  it("keeps re-resolving stale Enter while control focus normalization is pending", async () => {
    const popupManager = {
      launchNewPanePopup: vi.fn(async () => ({ prompt: "pending control focus" })),
      launchKebabMenuPopup: vi.fn(),
    }
    const handlePaneCreationWithAgent = vi.fn(async () => [])
    const setSelectedIndex = vi.fn()

    await withTmuxEnv(async () => {
      const { stdin, unmount } = render(
        <Harness
          panes={[pane("1")]}
          selectedIndex={0}
          presentationMode="grid"
          popupManager={popupManager}
          settingsManager={{
            updateSetting: vi.fn(),
            getEffectiveScope: vi.fn(() => "global"),
          }}
          setSelectedIndex={setSelectedIndex}
          handlePaneCreationWithAgent={handlePaneCreationWithAgent}
          getActiveSurface={() => "control"}
          isControlPaneSelectionPending={() => true}
          projectActionItems={[
            { index: 1, projectRoot: "/repo", projectName: "repo", kind: "new-agent", hotkey: "n" },
          ]}
        />
      )

      await sleep(20)
      stdin.write("\r")
      await sleep(80)

      expect(tmuxServiceMock.getActivePaneId).toHaveBeenCalledTimes(1)
      expect(setSelectedIndex).toHaveBeenCalledWith(1)
      expect(popupManager.launchNewPanePopup).toHaveBeenCalledWith("/repo")
      expect(handlePaneCreationWithAgent).toHaveBeenCalledWith(
        { prompt: "pending control focus" },
        "/repo"
      )
      expect(popupManager.launchKebabMenuPopup).not.toHaveBeenCalled()

      unmount()
    })
  })

  it("lets explicit arrow navigation choose the pane while control focus is pending", async () => {
    let currentSelectedIndex = 1
    let controlSelectionPending = true
    const popupManager = {
      launchNewPanePopup: vi.fn(async () => ({ prompt: "should not launch" })),
      launchKebabMenuPopup: vi.fn(async () => null),
    }
    const handlePaneCreationWithAgent = vi.fn(async () => [])
    const setSelectedIndex = vi.fn((index: number) => {
      currentSelectedIndex = index
    })
    const clearControlPaneSelectionPending = vi.fn(() => {
      controlSelectionPending = false
    })
    const findCardInDirection = vi.fn((
      currentIndex: number,
      direction: "up" | "down" | "left" | "right"
    ) => (
      currentIndex === 1 && direction === "up" ? 0 : null
    ))
    const projectActionItems: ProjectActionItem[] = [
      {
        index: 1,
        projectRoot: "/repo",
        projectName: "repo",
        kind: "new-agent",
        hotkey: "n",
      },
    ]

    const harness = () => (
      <Harness
        panes={[pane("1")]}
        selectedIndex={currentSelectedIndex}
        presentationMode="grid"
        popupManager={popupManager}
        settingsManager={quietSettingsManager()}
        setSelectedIndex={setSelectedIndex}
        handlePaneCreationWithAgent={handlePaneCreationWithAgent}
        getActiveSurface={() => "control"}
        isControlPaneSelectionPending={() => controlSelectionPending}
        clearControlPaneSelectionPending={clearControlPaneSelectionPending}
        projectActionItems={projectActionItems}
        findCardInDirection={findCardInDirection}
      />
    )
    const renderResult = render(harness())

    await sleep(20)
    renderResult.stdin.write("\u001B[A")
    await sleep(40)

    expect(findCardInDirection).toHaveBeenCalledWith(1, "up")
    expect(clearControlPaneSelectionPending).toHaveBeenCalledTimes(1)
    expect(setSelectedIndex).toHaveBeenCalledWith(0)

    renderResult.rerender(harness())

    await sleep(20)
    renderResult.stdin.write("\r")
    await sleep(80)

    expect(popupManager.launchKebabMenuPopup).not.toHaveBeenCalled()
    expect(popupManager.launchNewPanePopup).not.toHaveBeenCalled()
    expect(handlePaneCreationWithAgent).not.toHaveBeenCalled()
    expectSidebarFocusRestored()

    renderResult.unmount()
  })
})
