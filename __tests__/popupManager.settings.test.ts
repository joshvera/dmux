import { describe, expect, it, vi } from "vitest"
import { PopupManager, type PopupManagerConfig } from "../src/services/PopupManager.js"
import { INPUT_IGNORE_DELAY } from "../src/constants/timing.js"

function createPopupManager({
  popupsSupported = true,
  setStatusMessage = () => {},
  setIgnoreInput = () => {},
}: {
  popupsSupported?: boolean
  setStatusMessage?: (message: string) => void
  setIgnoreInput?: (ignore: boolean) => void
} = {}): PopupManager {
  const config: PopupManagerConfig = {
    sidebarWidth: 40,
    projectRoot: "/tmp/project",
    popupsSupported,
    isDevMode: false,
    terminalWidth: 120,
    terminalHeight: 40,
    availableAgents: ["claude"],
    settingsManager: {
      getSettings: () => ({}),
      getGlobalSettings: () => ({}),
      getProjectSettings: () => ({}),
    },
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
})
