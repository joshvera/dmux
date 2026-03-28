import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render } from "ink-testing-library"
import { Text } from "ink"
import { useInputHandling } from "../src/hooks/useInputHandling.js"
import { TmuxService } from "../src/services/TmuxService.js"
import type { DmuxPane } from "../src/types.js"
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
    projectRoot: "/repo",
    projectName: "repo",
    worktreePath: `/repo/.dmux/worktrees/pane-${id}`,
    ...options,
  }
}

function Harness({
  panes,
  selectedIndex = 0,
  presentationMode,
  popupManager,
  settingsManager,
  controlPaneId = "%0",
  setSelectedIndex = vi.fn(),
  setStatusMessage = vi.fn(),
  savePanes = vi.fn(async () => {}),
  loadPanes = vi.fn(async () => {}),
  handlePaneCreationWithAgent = vi.fn(async () => []),
}: {
  panes: DmuxPane[]
  selectedIndex?: number
  presentationMode: "grid" | "focus"
  popupManager: any
  settingsManager: any
  controlPaneId?: string
  setSelectedIndex?: ReturnType<typeof vi.fn>
  setStatusMessage?: ReturnType<typeof vi.fn>
  savePanes?: ReturnType<typeof vi.fn>
  loadPanes?: ReturnType<typeof vi.fn>
  handlePaneCreationWithAgent?: ReturnType<typeof vi.fn>
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
    showInlineSettings: false,
    setShowInlineSettings: vi.fn(),
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
    resetInlineSettings: vi.fn(),
    projectSettings: {},
    saveSettings: vi.fn(),
    settingsManager,
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
    cleanExit: vi.fn(),
    availableAgents: ["claude"],
    panesFile: "/repo/.dmux/dmux.config.json",
    projectRoot: "/repo",
    projectActionItems: [],
    findCardInDirection: vi.fn(() => null),
  })

  return <Text>dmux</Text>
}

describe("useInputHandling focus mode", () => {
  const tmuxServiceMock = {
    selectPane: vi.fn(async () => {}),
    joinPaneToTarget: vi.fn(async () => {}),
    breakPaneToWindow: vi.fn(async () => {}),
    splitPane: vi.fn(async () => "%2"),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getCurrentTmuxSessionName).mockReturnValue(null)
    vi.mocked(drainRemotePaneActions).mockResolvedValue([])
    vi.spyOn(TmuxService, "getInstance").mockReturnValue(
      tmuxServiceMock as unknown as TmuxService
    )
  })

  it("enters focus mode by isolating the selected pane and returning focus to the sidebar", async () => {
    const popupManager = {
      launchSettingsPopup: vi.fn(async () => ({
        key: "presentationMode",
        value: "focus",
        scope: "global",
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
})
