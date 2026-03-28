import { describe, expect, it, vi } from "vitest"
import { PopupManager, type PopupManagerConfig } from "../src/services/PopupManager.js"
import { INPUT_IGNORE_DELAY } from "../src/constants/timing.js"

function createPopupManager({
  popupsSupported = true,
  setStatusMessage = () => {},
  setIgnoreInput = () => {},
  settingsManager = {
    getSettings: () => ({}),
    getGlobalSettings: () => ({}),
    getProjectSettings: () => ({}),
  },
  getSettingsManagerForProjectRoot,
}: {
  popupsSupported?: boolean
  setStatusMessage?: (message: string) => void
  setIgnoreInput?: (ignore: boolean) => void
  settingsManager?: {
    getSettings: () => Record<string, unknown>
    getGlobalSettings: () => Record<string, unknown>
    getProjectSettings: () => Record<string, unknown>
  }
  getSettingsManagerForProjectRoot?: (projectRoot: string) => any
} = {}): PopupManager {
  const resolvedGetSettingsManagerForProjectRoot =
    getSettingsManagerForProjectRoot ?? (() => settingsManager)
  const config: PopupManagerConfig = {
    sidebarWidth: 40,
    projectRoot: "/tmp/project",
    popupsSupported,
    isDevMode: false,
    terminalWidth: 120,
    terminalHeight: 40,
    availableAgents: ["claude"],
    settingsManager,
    getSettingsManagerForProjectRoot: resolvedGetSettingsManagerForProjectRoot,
    projectSettings: {},
    trackProjectActivity: async (work) => await work(),
  }

  return new PopupManager(config, setStatusMessage, setIgnoreInput)
}

describe("PopupManager launchSettingsPopup", () => {
  it("reports unsupported popup environments explicitly", async () => {
    const manager = createPopupManager({ popupsSupported: false })

    await expect(
      manager.launchSettingsPopup(async () => {})
    ).resolves.toEqual({
      kind: "unavailable",
      reason: "unsupported",
    })
  })

  it("preserves popup cancellation instead of collapsing it into fallback-unavailable", async () => {
    vi.useFakeTimers()

    const setIgnoreInput = vi.fn()
    const manager = createPopupManager({ setIgnoreInput }) as any
    manager.launchPopup = vi.fn().mockResolvedValue({
      success: false,
      cancelled: true,
    })

    try {
      await expect(
        manager.launchSettingsPopup(async () => {})
      ).resolves.toEqual({
        kind: "cancelled",
      })

      expect(setIgnoreInput).toHaveBeenCalledWith(true)

      vi.advanceTimersByTime(INPUT_IGNORE_DELAY)

      expect(setIgnoreInput).toHaveBeenLastCalledWith(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it("normalizes successful updates into the completed updates array shape", async () => {
    vi.useFakeTimers()

    const setIgnoreInput = vi.fn()
    const manager = createPopupManager({ setIgnoreInput }) as any
    manager.launchPopup = vi.fn().mockResolvedValue({
      success: true,
      data: {
        key: "presentationMode",
        value: "focus",
        scope: "global",
      },
    })

    try {
      await expect(
        manager.launchSettingsPopup(async () => {})
      ).resolves.toEqual({
        kind: "completed",
        updates: [{
          key: "presentationMode",
          value: "focus",
          scope: "global",
        }],
      })

      expect(setIgnoreInput).toHaveBeenCalledWith(true)

      vi.advanceTimersByTime(INPUT_IGNORE_DELAY)

      expect(setIgnoreInput).toHaveBeenLastCalledWith(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it("drops invalid top-level setting keys instead of returning them as updates", async () => {
    const manager = createPopupManager() as any
    manager.launchPopup = vi.fn().mockResolvedValue({
      success: true,
      data: {
        key: "hooks",
        value: "ignored",
        scope: "project",
      },
    })

    await expect(
      manager.launchSettingsPopup(async () => {})
    ).resolves.toEqual({
      kind: "completed",
      updates: [],
    })
  })

  it("keeps valid mixed updates and drops unknown or blocked keys", async () => {
    const manager = createPopupManager() as any
    manager.launchPopup = vi.fn().mockResolvedValue({
      success: true,
      data: {
        updates: [
          {
            key: "presentationMode",
            value: "focus",
            scope: "global",
          },
          {
            key: "enabledAgents",
            value: ["claude"],
            scope: "project",
          },
          {
            key: "hooks",
            value: "ignored",
            scope: "project",
          },
          {
            key: "__proto__",
            value: { polluted: true },
            scope: "global",
          },
          {
            key: "notASetting",
            value: "ignored",
            scope: "global",
          },
        ],
      },
    })

    await expect(
      manager.launchSettingsPopup(async () => {})
    ).resolves.toEqual({
      kind: "completed",
      updates: [
        {
          key: "presentationMode",
          value: "focus",
          scope: "global",
        },
        {
          key: "enabledAgents",
          value: ["claude"],
          scope: "project",
        },
      ],
    })
  })

  it("builds the popup payload from the requested project root settings manager", async () => {
    const sessionManager = {
      getSettings: vi.fn(() => ({ showFooterTips: true })),
      getGlobalSettings: vi.fn(() => ({ showFooterTips: true })),
      getProjectSettings: vi.fn(() => ({ presentationMode: "grid" })),
    }
    const targetManager = {
      getSettings: vi.fn(() => ({ showFooterTips: false })),
      getGlobalSettings: vi.fn(() => ({ showFooterTips: true })),
      getProjectSettings: vi.fn(() => ({ presentationMode: "focus" })),
    }
    const getSettingsManagerForProjectRoot = vi.fn((projectRoot: string) =>
      projectRoot === "/repo-b" ? targetManager : sessionManager
    )
    const manager = createPopupManager({
      settingsManager: sessionManager,
      getSettingsManagerForProjectRoot,
    }) as any
    manager.launchPopup = vi.fn().mockResolvedValue({
      success: false,
      cancelled: true,
    })

    await manager.launchSettingsPopup(async () => {}, "/repo-b")

    expect(getSettingsManagerForProjectRoot).toHaveBeenCalledWith("/repo-b")
    expect(manager.launchPopup).toHaveBeenCalledWith(
      "settingsPopup.js",
      [],
      expect.any(Object),
      expect.objectContaining({
        settings: { showFooterTips: false },
        globalSettings: { showFooterTips: true },
        projectSettings: { presentationMode: "focus" },
        projectRoot: "/repo-b",
      }),
      "/repo-b"
    )
  })

  it("seeds enabled agents from the requested project root settings manager", async () => {
    const sessionManager = {
      getSettings: vi.fn(() => ({ enabledAgents: ["codex"] })),
      getGlobalSettings: vi.fn(() => ({})),
      getProjectSettings: vi.fn(() => ({})),
    }
    const targetManager = {
      getSettings: vi.fn(() => ({ enabledAgents: ["claude"] })),
      getGlobalSettings: vi.fn(() => ({})),
      getProjectSettings: vi.fn(() => ({})),
    }
    const manager = createPopupManager({
      settingsManager: sessionManager,
      getSettingsManagerForProjectRoot: vi.fn((projectRoot: string) =>
        projectRoot === "/repo-b" ? targetManager : sessionManager
      ),
    }) as any
    manager.launchPopup = vi.fn().mockResolvedValue({
      success: true,
      data: {
        enabledAgents: ["claude"],
        scope: "project",
      },
    })

    await expect(
      manager.launchEnabledAgentsPopup("/repo-b")
    ).resolves.toEqual({
      key: "enabledAgents",
      value: ["claude"],
      scope: "project",
    })

    expect(manager.launchPopup).toHaveBeenCalledWith(
      "enabledAgentsPopup.js",
      [],
      expect.any(Object),
      expect.objectContaining({
        enabledAgents: ["claude"],
      }),
      "/repo-b"
    )
  })

  it("seeds notification sounds from the requested project root settings manager", async () => {
    const sessionManager = {
      getSettings: vi.fn(() => ({ enabledNotificationSounds: ["harp"] })),
      getGlobalSettings: vi.fn(() => ({})),
      getProjectSettings: vi.fn(() => ({})),
    }
    const targetManager = {
      getSettings: vi.fn(() => ({ enabledNotificationSounds: ["default-system-sound"] })),
      getGlobalSettings: vi.fn(() => ({})),
      getProjectSettings: vi.fn(() => ({})),
    }
    const manager = createPopupManager({
      settingsManager: sessionManager,
      getSettingsManagerForProjectRoot: vi.fn((projectRoot: string) =>
        projectRoot === "/repo-b" ? targetManager : sessionManager
      ),
    }) as any
    manager.launchPopup = vi.fn().mockResolvedValue({
      success: true,
      data: {
        enabledNotificationSounds: ["default-system-sound"],
        scope: "project",
      },
    })

    await expect(
      manager.launchNotificationSoundsPopup("/repo-b")
    ).resolves.toEqual({
      key: "enabledNotificationSounds",
      value: ["default-system-sound"],
      scope: "project",
    })

    expect(manager.launchPopup).toHaveBeenCalledWith(
      "notificationSoundsPopup.js",
      [],
      expect.any(Object),
      expect.objectContaining({
        enabledNotificationSounds: ["default-system-sound"],
      }),
      "/repo-b"
    )
  })
})
