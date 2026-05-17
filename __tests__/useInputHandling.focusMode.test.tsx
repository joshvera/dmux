import React from "react"
import { beforeEach, describe, expect, it } from "vitest"
import { render } from "ink-testing-library"
import { Text } from "ink"
import { useInputHandling } from "../src/hooks/useInputHandling.js"
import type { DmuxPane, NewPaneInput } from "../src/types.js"
import type { ProjectActionItem } from "../src/utils/projectActions.js"
import type { RemotePaneActionShortcut } from "../src/utils/remotePaneActions.js"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type EventFn<Args extends unknown[], Result> = ((...args: Args) => Result) & {
  events: Args[]
  clear: () => void
}

function eventFn<Args extends unknown[], Result>(
  implementation: (...args: Args) => Result
): EventFn<Args, Result> {
  const events: Args[] = []
  const fn = ((...args: Args) => {
    events.push(args)
    return implementation(...args)
  }) as EventFn<Args, Result>
  fn.events = events
  fn.clear = () => {
    events.length = 0
  }
  return fn
}

function expectEvent<Args extends unknown[], Result>(
  fn: EventFn<Args, Result>,
  ...args: Args
) {
  expect(fn.events).toContainEqual(args)
}

function expectNoEvents<Args extends unknown[], Result>(fn: EventFn<Args, Result>) {
  expect(fn.events).toEqual([])
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

interface RemoteQueueState {
  sessionName: string | null
  queues: RemotePaneActionShortcut[][]
  drainedSessions: string[]
}

interface HarnessTmuxService {
  breakPaneToWindow: (paneId: string, windowName: string) => Promise<void>
  enterDetachConfirmMode: () => Promise<void>
  getActivePaneId: () => Promise<string>
  getCurrentPaneId: () => Promise<string>
  getPaneTitle: (paneId: string) => Promise<string>
  joinPaneToTarget: (paneId: string, targetPaneId: string) => Promise<void>
  normalizeClientKeyTableToRoot: () => Promise<boolean>
  selectPane: (paneId: string) => Promise<void>
  setPaneTitle: (paneId: string, title: string) => Promise<void>
  splitPane: (options?: {
    targetPane?: string
    cwd?: string
    command?: string
    preserveZoom?: boolean
  }) => Promise<string>
}

function createRemoteQueueState(): RemoteQueueState {
  return {
    sessionName: null,
    queues: [],
    drainedSessions: [],
  }
}

let harnessTmuxService: HarnessTmuxService
let harnessRemoteQueueState: RemoteQueueState
let harnessLayoutRefreshEvents: Array<{ paneId: string; width: number; options: { forceLayout?: boolean } }>

function Harness({
  panes,
  selectedIndex = 0,
  presentationMode,
  popupManager,
  settingsManager,
  getSettingsManagerForProjectRoot = () => settingsManager,
  controlPaneId = "%0",
  tmuxService = harnessTmuxService,
  remoteQueueState = harnessRemoteQueueState,
  layoutRefreshEvents = harnessLayoutRefreshEvents,
  setSelectedIndex = () => {},
  setStatusMessage = () => {},
  savePanes = async () => {},
  loadPanes = async () => {},
  getPanes = () => panes,
  handlePaneCreationWithAgent = async () => [],
  showInlineSettings = false,
  setShowInlineSettings = () => {},
  inlineSettingsProjectRoot,
  setInlineSettingsProjectRoot = () => {},
  projectActionItems = [],
  getActiveSurface,
  isControlPaneSelectionPending,
  clearControlPaneSelectionPending = () => {},
  isTmuxSession,
  findCardInDirection = () => null,
}: {
  panes: DmuxPane[]
  selectedIndex?: number
  presentationMode: "grid" | "focus"
  popupManager: any
  settingsManager: any
  getSettingsManagerForProjectRoot?: (projectRoot: string) => any
  controlPaneId?: string
  tmuxService?: HarnessTmuxService
  remoteQueueState?: RemoteQueueState
  layoutRefreshEvents?: Array<{ paneId: string; width: number; options: { forceLayout?: boolean } }>
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
  isTmuxSession?: () => boolean
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
    setIsCreatingPane: () => {},
    runningCommand: false,
    isUpdating: false,
    isLoading: false,
    ignoreInput: false,
    isDevMode: false,
    quitConfirmMode: false,
    setQuitConfirmMode: () => {},
    showCommandPrompt: null,
    setShowCommandPrompt: () => {},
    commandInput: "",
    setCommandInput: () => {},
    showFileCopyPrompt: false,
    setShowFileCopyPrompt: () => {},
    currentCommandType: null,
    setCurrentCommandType: () => {},
    showInlineSettings,
    setShowInlineSettings,
    inlineSettingsIndex: 0,
    setInlineSettingsIndex: () => {},
    inlineSettingsMode: "list" as const,
    setInlineSettingsMode: () => {},
    inlineSettingsEditingKey: undefined,
    setInlineSettingsEditingKey: () => {},
    inlineSettingsEditingValueIndex: 0,
    setInlineSettingsEditingValueIndex: () => {},
    inlineSettingsScopeIndex: 0,
    setInlineSettingsScopeIndex: () => {},
    inlineSettingsProjectRoot,
    setInlineSettingsProjectRoot,
    resetInlineSettings: () => {},
    projectSettings: {},
    saveSettings: async () => {},
    settingsManager,
    getSettingsManagerForProjectRoot,
    popupManager,
    actionSystem: {
      actionState: {},
      executeAction: async () => {},
      executeCallback: async () => {},
      clearDialog: () => {},
      clearStatus: () => {},
      setActionState: () => {},
    },
    controlPaneId,
    tmuxService,
    enforceControlPaneSizeFn: async (paneId, width, options) => {
      layoutRefreshEvents?.push({ paneId, width, options })
    },
    getCurrentTmuxSessionNameFn: () => remoteQueueState?.sessionName ?? null,
    drainRemotePaneActionsFn: async (sessionName) => {
      if (!remoteQueueState) {
        return []
      }
      remoteQueueState.drainedSessions.push(sessionName)
      return remoteQueueState.queues.shift() ?? []
    },
    createShellPaneFn: async (paneId, nextId) => ({
      id: `dmux-${nextId}`,
      slug: `shell-${nextId}`,
      prompt: "",
      paneId,
      projectRoot: "/repo",
      projectName: "repo",
      type: "shell",
      shellType: "shell",
    }),
    getActiveSurface,
    isControlPaneSelectionPending,
    clearControlPaneSelectionPending,
    isTmuxSession,
    trackProjectActivity: async (work: () => unknown) => await work(),
    presentationMode,
    popupsSupported: true,
    setStatusMessage,
    copyNonGitFiles: async () => {},
    runCommandInternal: async () => {},
    handlePaneCreationWithAgent,
    handleCreateChildWorktree: async () => {},
    handleReopenWorktree: async () => {},
    setDevSourceFromPane: async () => {},
    savePanes,
    sidebarProjects: [{ projectRoot: "/repo", projectName: "repo" }],
    saveSidebarProjects: async (projects) => projects,
    loadPanes,
    getPanes,
    cleanExit: () => {},
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
  selectedPaneIds: string[]
  normalizeClientKeyTableCount: number
  activePaneIdLookups: number
  hiddenWindows: Map<string, string>
  failedJoinPaneIds: Set<string>
  joins: Array<{ paneId: string; targetPaneId: string }>
  splitPaneIds: string[]
  createdPanes: string[]
  nextBreakPaneImplementation?: (paneId: string, windowName: string) => Promise<void>
}

function createFakeTmuxState(): FakeTmuxState {
  return {
    selectedPaneId: undefined,
    selectedPaneIds: [],
    normalizeClientKeyTableCount: 0,
    activePaneIdLookups: 0,
    hiddenWindows: new Map(),
    failedJoinPaneIds: new Set(),
    joins: [],
    splitPaneIds: [],
    createdPanes: [],
    nextBreakPaneImplementation: undefined,
  }
}

describe("useInputHandling focus mode", () => {
  let tmuxState = createFakeTmuxState()
  let remoteQueueState = createRemoteQueueState()
  let layoutRefreshEvents: Array<{ paneId: string; width: number; options: { forceLayout?: boolean } }> = []
  const tmuxServiceFake: HarnessTmuxService = {
    selectPane: async (paneId: string) => {
      tmuxState.selectedPaneId = paneId
      tmuxState.selectedPaneIds.push(paneId)
    },
    normalizeClientKeyTableToRoot: async () => {
      tmuxState.normalizeClientKeyTableCount += 1
      return true
    },
    getActivePaneId: async () => {
      tmuxState.activePaneIdLookups += 1
      return "%0"
    },
    getCurrentPaneId: async () => "%0",
    getPaneTitle: async () => "",
    joinPaneToTarget: async (paneId: string, targetPaneId: string) => {
      if (tmuxState.failedJoinPaneIds.has(paneId)) {
        throw new Error(`missing pane ${paneId}`)
      }
      tmuxState.joins.push({ paneId, targetPaneId })
    },
    breakPaneToWindow: async (paneId: string, windowName: string) => {
      if (tmuxState.nextBreakPaneImplementation) {
        const implementation = tmuxState.nextBreakPaneImplementation
        tmuxState.nextBreakPaneImplementation = undefined
        await implementation(paneId, windowName)
        return
      }
      tmuxState.hiddenWindows.set(paneId, windowName)
    },
    splitPane: async () => {
      const paneId = tmuxState.splitPaneIds.shift() || "%2"
      tmuxState.createdPanes.push(paneId)
      return paneId
    },
    setPaneTitle: async () => {},
    enterDetachConfirmMode: async () => {},
  }

  beforeEach(() => {
    tmuxState = createFakeTmuxState()
    remoteQueueState = createRemoteQueueState()
    layoutRefreshEvents = []
    harnessTmuxService = tmuxServiceFake
    harnessRemoteQueueState = remoteQueueState
    harnessLayoutRefreshEvents = layoutRefreshEvents
  })

  const clearFocusEvents = () => {
    tmuxState.selectedPaneIds = []
    tmuxState.normalizeClientKeyTableCount = 0
  }

  const expectSidebarFocusRestored = () => {
    expect(tmuxState.selectedPaneIds.at(-1)).toBe("%0")
    expect(tmuxState.selectedPaneId).toBe("%0")
    expect(tmuxState.normalizeClientKeyTableCount).toBeGreaterThan(0)
  }

  it("enters focus mode by isolating the selected pane and returning focus to the sidebar", async () => {
    const popupManager = {
      launchSettingsPopup: eventFn(async () => ({
        kind: "completed" as const,
        updates: [{
          key: "presentationMode",
          value: "focus",
          scope: "global" as const,
        }],
      })),
    }
    const settingsManager = {
      updateSetting: eventFn(() => undefined),
      getEffectiveScope: eventFn(() => "global"),
    }
    const savePanes = eventFn(async () => {})

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

    expectEvent(settingsManager.updateSetting,
      "presentationMode",
      "focus",
      "global"
    )
    expect(tmuxState.hiddenWindows).toEqual(new Map([
      ["%2", "dmux-hidden-2"],
    ]))
    expectEvent(savePanes, [
      expect.objectContaining({ id: "1", hidden: false }),
      expect.objectContaining({ id: "2", hidden: true }),
    ])
    expect(tmuxState.selectedPaneIds).toContain("%0")

    unmount()
  })

  it("does not open inline settings when the settings popup is cancelled", async () => {
    const setShowInlineSettings = eventFn(() => undefined)
    const popupManager = {
      launchSettingsPopup: eventFn(async () => ({
        kind: "cancelled" as const,
      })),
    }

    const { stdin, unmount } = render(
      <Harness
        panes={[pane("1")]}
        presentationMode="grid"
        popupManager={popupManager}
        settingsManager={{
          updateSetting: eventFn(() => undefined),
          getEffectiveScope: eventFn(() => "global"),
        }}
        setShowInlineSettings={setShowInlineSettings}
      />
    )

    await sleep(20)
    stdin.write("s")
    await sleep(40)

    expectNoEvents(setShowInlineSettings)

    unmount()
  })

  it("falls back to inline settings when popup launch is unavailable", async () => {
    const setShowInlineSettings = eventFn(() => undefined)
    const popupManager = {
      launchSettingsPopup: eventFn(async () => ({
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
          updateSetting: eventFn(() => undefined),
          getEffectiveScope: eventFn(() => "global"),
        }}
        setShowInlineSettings={setShowInlineSettings}
      />
    )

    await sleep(20)
    stdin.write("s")
    await sleep(40)

    expectEvent(setShowInlineSettings, true)

    unmount()
  })

  it("uses the latest active project root when remote settings are opened from an unmanaged pane", async () => {
    remoteQueueState.sessionName = "dmux-test"
    remoteQueueState.queues.push([], [{ shortcut: "m", targetPaneId: "%999" }])

    const popupManager = {
      launchHooksPopup: eventFn(async () => null),
      launchSettingsPopup: eventFn(async () => ({
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
          updateSetting: eventFn(() => undefined),
          getEffectiveScope: eventFn(() => "global"),
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
          updateSetting: eventFn(() => undefined),
          getEffectiveScope: eventFn(() => "global"),
        }}
        projectActionItems={[
          { index: 1, projectRoot: "/repo-b", projectName: "repo-b", kind: "new-agent", hotkey: "n" },
        ]}
      />
    )

    await sleep(20)
    process.emit("dmux-external-command-signal" as any)
    await sleep(80)

    expect(popupManager.launchSettingsPopup.events.at(-1)).toEqual([
      expect.any(Function),
      "/repo-b",
    ])

    renderResult.unmount()
  })

  it("applies non-session project settings updates to the selected sidebar project root", async () => {
    remoteQueueState.sessionName = "dmux-test"
    remoteQueueState.queues.push([], [{ shortcut: "m", targetPaneId: "%999" }])

    const popupManager = {
      launchHooksPopup: eventFn(async () => null),
      launchSettingsPopup: eventFn(async () => ({
        kind: "completed" as const,
        updates: [{
          key: "showFooterTips",
          value: false,
          scope: "project" as const,
        }],
      })),
    }
    const sessionSettingsManager = {
      updateSetting: eventFn(() => undefined),
      getEffectiveScope: eventFn(() => "global"),
      getSettings: eventFn(() => ({ showFooterTips: true })),
    }
    const repoBSettingsManager = {
      updateSetting: eventFn(() => undefined),
      getSettings: eventFn(() => ({ showFooterTips: true })),
    }
    const getSettingsManagerForProjectRoot = eventFn((projectRoot: string) =>
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

    expectEvent(repoBSettingsManager.updateSetting,
      "showFooterTips",
      false,
      "project"
    )
    expectNoEvents(sessionSettingsManager.updateSetting)

    unmount()
  })

  it("targets the selected sidebar project when falling back to inline settings", async () => {
    remoteQueueState.sessionName = "dmux-test"
    remoteQueueState.queues.push([], [{ shortcut: "m", targetPaneId: "%999" }])

    const setShowInlineSettings = eventFn(() => undefined)
    const setInlineSettingsProjectRoot = eventFn(() => undefined)
    const popupManager = {
      launchHooksPopup: eventFn(async () => null),
      launchSettingsPopup: eventFn(async () => ({
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
          updateSetting: eventFn(() => undefined),
          getEffectiveScope: eventFn(() => "global"),
          getSettings: eventFn(() => ({})),
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

    expectEvent(setInlineSettingsProjectRoot, "/repo-b")
    expectEvent(setShowInlineSettings, true)

    unmount()
  })

  it("persists non-session project presentation mode without live-applying it to the current session", async () => {
    remoteQueueState.sessionName = "dmux-test"
    remoteQueueState.queues.push([], [{ shortcut: "m", targetPaneId: "%999" }])

    const popupManager = {
      launchHooksPopup: eventFn(async () => null),
      launchSettingsPopup: eventFn(async () => ({
        kind: "completed" as const,
        updates: [{
          key: "presentationMode",
          value: "focus",
          scope: "project" as const,
        }],
      })),
    }
    const sessionSettingsManager = {
      updateSetting: eventFn(() => undefined),
      getEffectiveScope: eventFn(() => "global"),
      getSettings: eventFn(() => ({ presentationMode: "grid" })),
    }
    const repoBSettingsManager = {
      updateSetting: eventFn(() => undefined),
      getSettings: eventFn(() => ({ presentationMode: "grid" })),
    }
    const getSettingsManagerForProjectRoot = eventFn((projectRoot: string) =>
      projectRoot === "/repo-b" ? repoBSettingsManager : sessionSettingsManager
    )
    const savePanes = eventFn(async () => {})

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

    expectEvent(repoBSettingsManager.updateSetting,
      "presentationMode",
      "focus",
      "project"
    )
    expectNoEvents(sessionSettingsManager.updateSetting)
    expect(tmuxState.hiddenWindows.size).toBe(0)
    expectNoEvents(savePanes)

    unmount()
  })

  it("blocks remote queued actions while inline settings are open", async () => {
    remoteQueueState.sessionName = "dmux-test"
    remoteQueueState.queues.push([{ shortcut: "m", targetPaneId: "%999" }])

    const popupManager = {
      launchSettingsPopup: eventFn(() => undefined),
    }
    const setStatusMessage = eventFn(() => undefined)

    const { unmount } = render(
      <Harness
        panes={[pane("1")]}
        presentationMode="grid"
        popupManager={popupManager}
        settingsManager={{
          updateSetting: eventFn(() => undefined),
          getEffectiveScope: eventFn(() => "global"),
        }}
        showInlineSettings={true}
        setStatusMessage={setStatusMessage}
      />
    )

    await sleep(80)

    expectNoEvents(popupManager.launchSettingsPopup)
    expectEvent(setStatusMessage,
      "dmux is busy; ignored remote pane action m"
    )

    unmount()
  })

  it("refreshes layout once when remote settings update pane width bounds", async () => {
    remoteQueueState.sessionName = "dmux-test"
    remoteQueueState.queues.push([{ shortcut: "m", targetPaneId: "%999" }])

    const popupManager = {
      launchHooksPopup: eventFn(async () => null),
      launchSettingsPopup: eventFn(async () => ({
        kind: "completed" as const,
        updates: [{
          key: "minPaneWidth",
          value: 72,
          scope: "global" as const,
        }],
      })),
    }
    const settingsManager = {
      updateSetting: eventFn(() => undefined),
      getEffectiveScope: eventFn(() => "global"),
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

    expectEvent(settingsManager.updateSetting,
      "minPaneWidth",
      72,
      "global"
    )
    expect(layoutRefreshEvents).toHaveLength(1)
    expect(layoutRefreshEvents[0]).toEqual({
      paneId: "%0",
      width: expect.any(Number),
      options: { forceLayout: true },
    })

    unmount()
  })

  it("does not persist presentation mode when the live tmux apply fails", async () => {
    tmuxState.nextBreakPaneImplementation = async () => {
      throw new Error("break-pane failed")
    }

    const popupManager = {
      launchSettingsPopup: eventFn(async () => ({
        kind: "completed" as const,
        updates: [{
          key: "presentationMode",
          value: "focus",
          scope: "global" as const,
        }],
      })),
    }
    const settingsManager = {
      updateSetting: eventFn(() => undefined),
      getEffectiveScope: eventFn(() => "global"),
      getSettings: eventFn(() => ({ presentationMode: "grid" })),
    }
    const setStatusMessage = eventFn(() => undefined)

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

    expectNoEvents(settingsManager.updateSetting)
    expectEvent(setStatusMessage,
      "Failed to save setting: break-pane failed"
    )

    unmount()
  })

  it("restores the previous pane visibility snapshot when presentation mode persistence fails", async () => {
    const popupManager = {
      launchSettingsPopup: eventFn(async () => ({
        kind: "completed" as const,
        updates: [{
          key: "presentationMode",
          value: "focus",
          scope: "global" as const,
        }],
      })),
    }
    const settingsManager = {
      updateSetting: eventFn(() => {
        throw new Error("disk full")
      }),
      getEffectiveScope: eventFn(() => "global"),
      getSettings: eventFn(() => ({ presentationMode: "grid" })),
    }
    const savePanes = eventFn(async () => {})
    const loadPanes = eventFn(async () => {})
    const setStatusMessage = eventFn(() => undefined)

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

    expect(tmuxState.hiddenWindows).toEqual(new Map([
      ["%2", "dmux-hidden-2"],
    ]))
    expect(tmuxState.joins).toContainEqual({ paneId: "%2", targetPaneId: "%1" })
    expect(savePanes.events[0]).toEqual([[
      expect.objectContaining({ id: "1", hidden: false }),
      expect.objectContaining({ id: "2", hidden: true }),
    ]])
    expect(savePanes.events[1]?.[0]).toEqual([
      expect.objectContaining({ id: "1" }),
      expect.objectContaining({ id: "2" }),
    ])
    expect((savePanes.events[1]?.[0] as DmuxPane[]).every((pane) => pane.hidden !== true)).toBe(true)
    expectEvent(setStatusMessage, "Failed to save setting: disk full")

    unmount()
  })

  it("preserves panes that appear after focus isolation starts", async () => {
    const basePanes = [pane("1"), pane("2")]
    const concurrentPane = pane("3", { prompt: "concurrent work" })
    let latestPanes = basePanes
    let savedPanes: DmuxPane[] = []
    const popupManager = {
      launchSettingsPopup: eventFn(async () => ({
        kind: "completed" as const,
        updates: [{
          key: "presentationMode",
          value: "focus",
          scope: "global" as const,
        }],
      })),
    }
    const settingsManager = {
      updateSetting: eventFn(() => undefined),
      getEffectiveScope: eventFn(() => "global"),
      getSettings: eventFn(() => ({ presentationMode: "grid" })),
    }
    tmuxState.nextBreakPaneImplementation = async (paneId, windowName) => {
      tmuxState.hiddenWindows.set(paneId, windowName)
      latestPanes = [...basePanes, concurrentPane]
    }

    const { stdin, unmount } = render(
      <Harness
        panes={basePanes}
        presentationMode="grid"
        popupManager={popupManager}
        settingsManager={settingsManager}
        savePanes={async (nextPanes) => {
          savedPanes = nextPanes
        }}
        getPanes={() => latestPanes}
      />
    )

    await sleep(20)
    stdin.write("s")
    await sleep(100)

    expect(tmuxState.hiddenWindows).toEqual(new Map([
      ["%2", "dmux-hidden-2"],
    ]))
    expect(savedPanes.map((entry) => entry.id)).toEqual(["1", "2", "3"])
    expect(savedPanes.find((entry) => entry.id === "1")?.hidden).toBe(false)
    expect(savedPanes.find((entry) => entry.id === "2")?.hidden).toBe(true)
    expect(savedPanes.find((entry) => entry.id === "3")?.hidden).not.toBe(true)
    expect(savedPanes.find((entry) => entry.id === "3")?.prompt).toBe("concurrent work")

    unmount()
  })

  it("preserves latest panes when revealing a hidden grid pane", async () => {
    const hiddenPane = pane("1", { hidden: true })
    const visiblePane = pane("2")
    const concurrentPane = pane("3", {
      hidden: true,
      prompt: "concurrent hidden pane",
    })
    const latestPanes = [hiddenPane, visiblePane, concurrentPane]
    let savedPanes: DmuxPane[] = []

    const { stdin, unmount } = render(
      <Harness
        panes={[hiddenPane, visiblePane]}
        selectedIndex={0}
        presentationMode="grid"
        popupManager={{}}
        settingsManager={quietSettingsManager()}
        savePanes={async (nextPanes) => {
          savedPanes = nextPanes
        }}
        getPanes={() => latestPanes}
      />
    )

    await sleep(20)
    stdin.write("\r")
    await sleep(80)

    expect(tmuxState.joins).toEqual([{ paneId: "%1", targetPaneId: "%2" }])
    expect(savedPanes.map((entry) => entry.id)).toEqual(["1", "2", "3"])
    expect(savedPanes.find((entry) => entry.id === "1")?.hidden).toBe(false)
    expect(savedPanes.find((entry) => entry.id === "2")?.hidden).not.toBe(true)
    expect(savedPanes.find((entry) => entry.id === "3")?.hidden).toBe(true)
    expect(savedPanes.find((entry) => entry.id === "3")?.prompt).toBe("concurrent hidden pane")

    unmount()
  })

  it("uses latest pane state when revealing all hidden panes", async () => {
    const hiddenPane = pane("1", { hidden: true })
    const renderTimeVisiblePane = pane("2", { paneId: "%stale" })
    const latestHiddenPane = pane("2", {
      hidden: true,
      paneId: "%2",
      prompt: "concurrent hidden pane",
    })
    const concurrentPane = pane("3", {
      prompt: "concurrent visible pane",
      type: "shell",
      shellType: "fb",
    })
    const latestPanes = [hiddenPane, latestHiddenPane, concurrentPane]
    let savedPanes: DmuxPane[] = []
    const popupManager = {
      launchSettingsPopup: eventFn(async () => ({
        kind: "completed" as const,
        updates: [{
          key: "presentationMode",
          value: "grid",
          scope: "global" as const,
        }],
      })),
    }
    const settingsManager = {
      updateSetting: eventFn(() => undefined),
      getEffectiveScope: eventFn(() => "global"),
      getSettings: eventFn(() => ({ presentationMode: "focus" })),
    }

    const { stdin, unmount } = render(
      <Harness
        panes={[hiddenPane, renderTimeVisiblePane]}
        presentationMode="focus"
        popupManager={popupManager}
        settingsManager={settingsManager}
        savePanes={async (nextPanes) => {
          savedPanes = nextPanes
        }}
        getPanes={() => latestPanes}
      />
    )

    await sleep(20)
    stdin.write("s")
    await sleep(100)

    expect(tmuxState.joins).toEqual(expect.arrayContaining([
      { paneId: "%1", targetPaneId: "%3" },
      { paneId: "%2", targetPaneId: "%3" },
    ]))
    expect(tmuxState.joins.every((join) => join.targetPaneId === "%3")).toBe(true)
    expect(savedPanes.map((entry) => entry.id)).toEqual(["1", "2", "3"])
    expect(savedPanes.find((entry) => entry.id === "1")?.hidden).toBe(false)
    expect(savedPanes.find((entry) => entry.id === "2")?.hidden).toBe(false)
    expect(savedPanes.find((entry) => entry.id === "2")?.prompt).toBe("concurrent hidden pane")
    expect(savedPanes.find((entry) => entry.id === "3")?.hidden).not.toBe(true)
    expect(savedPanes.find((entry) => entry.id === "3")?.prompt).toBe("concurrent visible pane")
    expect(savedPanes.find((entry) => entry.id === "3")?.shellType).toBe("fb")

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
          updateSetting: eventFn(() => undefined),
          getEffectiveScope: eventFn(() => "global"),
        }}
      />
    )

    await sleep(40)
    tmuxState.selectedPaneIds = []

    stdin.write("j")
    await sleep(40)

    expect(tmuxState.selectedPaneIds).toContain("%2")

    unmount()
  })

  it("selects a visible grid pane on Enter", async () => {
    const popupManager = {
      launchKebabMenuPopup: eventFn(() => undefined),
    }
    const setSelectedIndex = eventFn(() => undefined)

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
    clearFocusEvents()

    stdin.write("\r")
    await sleep(80)

    expectNoEvents(popupManager.launchKebabMenuPopup)
    expectEvent(setSelectedIndex, 1)
    expect(tmuxState.selectedPaneIds).toContain("%2")
    expect(tmuxState.selectedPaneId).toBe("%2")
    expect(tmuxState.selectedPaneIds).not.toContain("%0")

    unmount()
  })

  it("reveals and selects a hidden grid pane on Enter", async () => {
    let currentPanes = [pane("1", { hidden: true }), pane("2")]
    const popupManager = {
      launchKebabMenuPopup: eventFn(() => undefined),
    }
    const setSelectedIndex = eventFn(() => undefined)
    const savePanes = eventFn(async (updatedPanes: DmuxPane[]) => {
      currentPanes = updatedPanes.map((updatedPane) => ({ ...updatedPane }))
    })
    const loadPanes = eventFn(async () => {})

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
    clearFocusEvents()

    stdin.write("\r")
    await sleep(80)

    expectNoEvents(popupManager.launchKebabMenuPopup)
    expect(tmuxState.joins).toContainEqual({ paneId: "%1", targetPaneId: "%2" })
    expectEvent(savePanes, [
      expect.objectContaining({ id: "1", hidden: false }),
      expect.objectContaining({ id: "2" }),
    ])
    expect(loadPanes.events.length).toBeGreaterThan(0)
    expectEvent(setSelectedIndex, 0)
    expect(tmuxState.selectedPaneIds).toContain("%1")
    expect(tmuxState.selectedPaneId).toBe("%1")
    expect(tmuxState.selectedPaneIds).not.toContain("%0")

    unmount()
  })

  it("selects a pane on Enter in focus mode", async () => {
    const popupManager = {
      launchKebabMenuPopup: eventFn(() => undefined),
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
    clearFocusEvents()

    stdin.write("\r")
    await sleep(80)

    expectNoEvents(popupManager.launchKebabMenuPopup)
    expect(tmuxState.selectedPaneIds).toContain("%2")
    expect(tmuxState.selectedPaneId).toBe("%2")
    expect(tmuxState.selectedPaneIds).not.toContain("%0")

    unmount()
  })

  it("keeps m as the explicit pane menu shortcut", async () => {
    const popupManager = {
      launchKebabMenuPopup: eventFn(async () => null),
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

    expectEvent(popupManager.launchKebabMenuPopup,
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

  it("replaces a stale hidden file browser when activation fails", async () => {
    const workPane = pane("1")
    const staleBrowserPane = pane("3", {
      hidden: true,
      paneId: "%missing",
      type: "shell",
      shellType: "fb",
      browserPath: workPane.worktreePath,
    })
    let savedPanes: DmuxPane[] = []
    const savePanes = async (nextPanes: DmuxPane[]) => {
      savedPanes = nextPanes
    }
    const loadPanes = eventFn(async () => {})
    tmuxState.splitPaneIds.push("%9")
    tmuxState.failedJoinPaneIds.add("%missing")

    const { stdin, unmount } = render(
      <Harness
        panes={[workPane, staleBrowserPane]}
        selectedIndex={0}
        presentationMode="grid"
        popupManager={{}}
        settingsManager={quietSettingsManager()}
        savePanes={savePanes}
        loadPanes={loadPanes}
      />
    )

    await sleep(20)
    stdin.write("f")
    await sleep(500)

    expect(tmuxState.createdPanes).toEqual(["%9"])
    expect(tmuxState.selectedPaneId).toBeUndefined()
    expect(savedPanes.some((pane) => pane.id === staleBrowserPane.id)).toBe(false)
    expect(savedPanes).toEqual([
      expect.objectContaining({ id: workPane.id }),
      expect.objectContaining({
        paneId: "%9",
        type: "shell",
        shellType: "fb",
        browserPath: workPane.worktreePath,
      }),
    ])
    expect(loadPanes.events.length).toBeGreaterThan(0)

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
    const setSelectedIndex = eventFn(() => undefined)

    const { unmount } = render(
      <Harness
        panes={[pane("1", { hidden: true }), pane("2")]}
        selectedIndex={0}
        presentationMode="focus"
        popupManager={{}}
        settingsManager={{
          updateSetting: eventFn(() => undefined),
          getEffectiveScope: eventFn(() => "global"),
        }}
        setSelectedIndex={setSelectedIndex}
      />
    )

    await sleep(60)

    expectEvent(setSelectedIndex, 1)
    expect(tmuxState.joins.some((join) => join.paneId === "%1")).toBe(false)

    unmount()
  })

  it("keeps the selected hidden pane hidden when focus mode has no visible panes", async () => {
    const savePanes = eventFn(async () => {})
    const setSelectedIndex = eventFn(() => undefined)

    const { unmount } = render(
      <Harness
        panes={[pane("1", { hidden: true }), pane("2", { hidden: true })]}
        selectedIndex={1}
        presentationMode="focus"
        popupManager={{}}
        settingsManager={{
          updateSetting: eventFn(() => undefined),
          getEffectiveScope: eventFn(() => "global"),
        }}
        savePanes={savePanes}
        setSelectedIndex={setSelectedIndex}
      />
    )

    await sleep(60)

    expect(tmuxState.joins).toEqual([])
    expectNoEvents(setSelectedIndex)
    expectNoEvents(savePanes)

    unmount()
  })

  it("leaves all panes hidden after hiding the last visible pane in focus mode", async () => {
    let currentPanes = [pane("1"), pane("2", { hidden: true })]
    let currentSelectedIndex = 0

    const savePanes = eventFn(async (updatedPanes: DmuxPane[]) => {
      currentPanes = updatedPanes.map((pane) => ({ ...pane }))
    })
    const setSelectedIndex = eventFn((index: number) => {
      currentSelectedIndex = index
    })

    const renderResult = render(
      <Harness
        panes={currentPanes}
        selectedIndex={currentSelectedIndex}
        presentationMode="focus"
        popupManager={{}}
        settingsManager={{
          updateSetting: eventFn(() => undefined),
          getEffectiveScope: eventFn(() => "global"),
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
          updateSetting: eventFn(() => undefined),
          getEffectiveScope: eventFn(() => "global"),
        }}
        savePanes={savePanes}
        setSelectedIndex={setSelectedIndex}
      />
    )

    await sleep(80)

    expectNoEvents(setSelectedIndex)
    expect(tmuxState.selectedPaneIds).toContain("%0")
    expect(tmuxState.normalizeClientKeyTableCount).toBeGreaterThan(0)
    expect(tmuxState.joins).toEqual([])
    expect(currentPanes).toEqual([
      expect.objectContaining({ id: "1", hidden: true }),
      expect.objectContaining({ id: "2", hidden: true }),
    ])

    renderResult.unmount()
  })

  it("keeps sidebar focus after hiding other panes from the sidebar", async () => {
    const savePanes = eventFn(async () => {})

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
    clearFocusEvents()

    stdin.write("H")
    await sleep(80)

    expect(tmuxState.hiddenWindows).toEqual(new Map([
      ["%2", "dmux-hidden-2"],
    ]))
    expectEvent(savePanes, [
      expect.objectContaining({ id: "1" }),
      expect.objectContaining({ id: "2", hidden: true }),
    ])
    expectSidebarFocusRestored()

    unmount()
  })

  it("keeps sidebar focus after focusing a project from the sidebar", async () => {
    const savePanes = eventFn(async () => {})
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
    clearFocusEvents()

    stdin.write("P")
    await sleep(80)

    expect(tmuxState.hiddenWindows).toEqual(new Map([
      ["%2", "dmux-hidden-2"],
    ]))
    expectEvent(savePanes, [
      expect.objectContaining({ id: "1" }),
      expect.objectContaining({ id: "2", hidden: true }),
    ])
    expectSidebarFocusRestored()

    unmount()
  })

  it("keeps a newly created pane active after the panes list reloads in focus mode", async () => {
    const popupManager = {
      launchNewPanePopup: eventFn(async () => "Build the feature"),
    }
    const settingsManager = {
      updateSetting: eventFn(() => undefined),
      getEffectiveScope: eventFn(() => "global"),
    }
    const savePanes = eventFn(async () => {})
    const loadPanes = eventFn(async () => {})
    const setSelectedIndex = eventFn(() => undefined)
    const newPane = pane("2")
    const handlePaneCreationWithAgent = eventFn(async () => [newPane])

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

    expectEvent(handlePaneCreationWithAgent, "Build the feature", "/repo")

    tmuxState.hiddenWindows.clear()
    tmuxState.selectedPaneIds = []
    savePanes.clear()
    setSelectedIndex.clear()

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

    expectEvent(setSelectedIndex, 1)
    expect(tmuxState.hiddenWindows).toEqual(new Map([
      ["%1", "dmux-hidden-1"],
    ]))
    expect(tmuxState.selectedPaneIds).toContain("%2")
    expectEvent(savePanes, [
      expect.objectContaining({ id: "1", hidden: true }),
      expect.objectContaining({ id: "2", hidden: false }),
    ])

    renderResult.unmount()
  })

  it("uses Enter on a selected project action instead of opening a stale pane menu", async () => {
    const popupManager = {
      launchNewPanePopup: eventFn(async () => ({ prompt: "from action" })),
      launchKebabMenuPopup: eventFn(() => undefined),
    }
    const handlePaneCreationWithAgent = eventFn(async () => [])

    const { stdin, unmount } = render(
      <Harness
        panes={[pane("1")]}
        selectedIndex={1}
        presentationMode="grid"
        popupManager={popupManager}
        settingsManager={{
          updateSetting: eventFn(() => undefined),
          getEffectiveScope: eventFn(() => "global"),
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

    expectEvent(popupManager.launchNewPanePopup, "/repo-b")
    expectEvent(handlePaneCreationWithAgent, { prompt: "from action" }, "/repo-b")
    expectNoEvents(popupManager.launchKebabMenuPopup)

    unmount()
  })

  it("uses the visible pane selection for Enter after returning to the control pane", async () => {
    const popupManager = {
      launchNewPanePopup: eventFn(async () => ({ prompt: "from control focus" })),
      launchKebabMenuPopup: eventFn(() => undefined),
    }
    const handlePaneCreationWithAgent = eventFn(async () => [])
    const setSelectedIndex = eventFn(() => undefined)

    const { stdin, unmount } = render(
      <Harness
        panes={[pane("1")]}
        selectedIndex={0}
        presentationMode="grid"
        popupManager={popupManager}
        settingsManager={{
          updateSetting: eventFn(() => undefined),
          getEffectiveScope: eventFn(() => "global"),
        }}
        setSelectedIndex={setSelectedIndex}
        handlePaneCreationWithAgent={handlePaneCreationWithAgent}
        getActiveSurface={() => "work"}
        isTmuxSession={() => true}
        projectActionItems={[
          { index: 1, projectRoot: "/repo", projectName: "repo", kind: "new-agent", hotkey: "n" },
        ]}
      />
    )

    await sleep(20)
    stdin.write("\r")
    await sleep(80)

    expect(tmuxState.activePaneIdLookups).toBe(0)
    expect(tmuxState.selectedPaneIds).toContain("%1")
    expectEvent(setSelectedIndex, 0)
    expectNoEvents(popupManager.launchNewPanePopup)
    expectNoEvents(handlePaneCreationWithAgent)
    expectNoEvents(popupManager.launchKebabMenuPopup)

    unmount()
  })

  it("does not launch a project action while a visible pane selection is pending", async () => {
    const popupManager = {
      launchNewPanePopup: eventFn(async () => ({ prompt: "pending control focus" })),
      launchKebabMenuPopup: eventFn(() => undefined),
    }
    const handlePaneCreationWithAgent = eventFn(async () => [])
    const setSelectedIndex = eventFn(() => undefined)

    const { stdin, unmount } = render(
      <Harness
        panes={[pane("1")]}
        selectedIndex={0}
        presentationMode="grid"
        popupManager={popupManager}
        settingsManager={{
          updateSetting: eventFn(() => undefined),
          getEffectiveScope: eventFn(() => "global"),
        }}
        setSelectedIndex={setSelectedIndex}
        handlePaneCreationWithAgent={handlePaneCreationWithAgent}
        getActiveSurface={() => "control"}
        isControlPaneSelectionPending={() => true}
        isTmuxSession={() => true}
        projectActionItems={[
          { index: 1, projectRoot: "/repo", projectName: "repo", kind: "new-agent", hotkey: "n" },
        ]}
      />
    )

    await sleep(20)
    stdin.write("\r")
    await sleep(80)

    expect(tmuxState.activePaneIdLookups).toBe(0)
    expect(tmuxState.selectedPaneIds).toContain("%1")
    expectEvent(setSelectedIndex, 0)
    expectNoEvents(popupManager.launchNewPanePopup)
    expectNoEvents(handlePaneCreationWithAgent)
    expectNoEvents(popupManager.launchKebabMenuPopup)

    unmount()
  })

  it("lets explicit arrow navigation choose the pane while control focus is pending", async () => {
    let currentSelectedIndex = 1
    let controlSelectionPending = true
    const popupManager = {
      launchNewPanePopup: eventFn(async () => ({ prompt: "should not launch" })),
      launchKebabMenuPopup: eventFn(async () => null),
    }
    const handlePaneCreationWithAgent = eventFn(async () => [])
    const setSelectedIndex = eventFn((index: number) => {
      currentSelectedIndex = index
    })
    const clearControlPaneSelectionPending = eventFn(() => {
      controlSelectionPending = false
    })
    const findCardInDirection = eventFn((
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

    expectEvent(findCardInDirection, 1, "up")
    expectEvent(clearControlPaneSelectionPending)
    expectEvent(setSelectedIndex, 0)

    renderResult.rerender(harness())

    await sleep(20)
    renderResult.stdin.write("\r")
    await sleep(80)

    expectNoEvents(popupManager.launchKebabMenuPopup)
    expectNoEvents(popupManager.launchNewPanePopup)
    expectNoEvents(handlePaneCreationWithAgent)
    expect(tmuxState.selectedPaneIds).toContain("%1")
    expect(tmuxState.selectedPaneId).toBe("%1")

    renderResult.unmount()
  })
})
