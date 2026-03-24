import { describe, expect, it } from "vitest"
import { execSync } from "child_process"
import fs from "fs"
import fsp from "fs/promises"
import os from "os"
import path from "path"
import type { DmuxPane } from "../src/types.js"
import { TmuxService } from "../src/services/TmuxService.js"
import {
  applyBulkVisibilityToggle,
  applyPaneVisibilityToggle,
  applyProjectVisibilityToggle,
} from "../src/utils/paneVisibilityMutations.js"
import { createCanonicalFocusModeFixture } from "./fixtures/focusMode.js"

function hasCmd(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: "pipe" })
    return true
  } catch {
    return false
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const runE2E = process.env.DMUX_E2E === "1"
const canRun = runE2E && hasCmd("tmux")

async function withTmuxFixture(
  callback: (context: {
    panes: DmuxPane[]
    getCurrentPanes: () => DmuxPane[]
    getCurrentWindowPaneIds: () => string[]
    buildDeps: () => {
      panes: DmuxPane[]
      tmuxService: TmuxService
      getPaneShowTarget: (excludedPaneId?: string) => Promise<string | null>
      savePanes: (panes: DmuxPane[]) => Promise<void>
      loadPanes: () => Promise<void>
      refreshPaneLayout: () => Promise<void>
    }
    fixture: ReturnType<typeof createCanonicalFocusModeFixture>
  }) => Promise<void>
) {
  const server = `dmux-focus-actions-${Date.now()}`
  const session = "dmux-focus-actions"
  const windowWidth = 320
  const windowHeight = 120
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "dmux-focus-actions-"))
  const wrapperDir = path.join(tmpDir, "bin")
  const wrapperPath = path.join(wrapperDir, "tmux")
  const realTmuxPath = execSync("command -v tmux", {
    encoding: "utf-8",
    stdio: "pipe",
  }).trim()
  const originalPath = process.env.PATH || ""

  await fsp.mkdir(wrapperDir, { recursive: true })
  await fsp.writeFile(
    wrapperPath,
    `#!/bin/sh\nexec "${realTmuxPath}" -L "${server}" "$@"\n`
  )
  await fsp.chmod(wrapperPath, 0o755)
  process.env.PATH = `${wrapperDir}:${originalPath}`

  try {
    execSync(
      `tmux -f /dev/null new-session -d -x ${windowWidth} -y ${windowHeight} -s ${session} -n main sh`,
      {
        stdio: "pipe",
      }
    )
    execSync(
      `tmux resize-window -t ${session}:0 -x ${windowWidth} -y ${windowHeight}`,
      {
        stdio: "pipe",
      }
    )

    for (let index = 0; index < 4; index += 1) {
      execSync(`tmux split-window -h -t ${session}:0.0 -P -F '#{pane_id}'`, {
        stdio: "pipe",
      })
      await sleep(20)
    }

    const paneIds = execSync(
      `tmux list-panes -t ${session}:0 -F '#{pane_id}'`,
      {
        encoding: "utf-8",
        stdio: "pipe",
      }
    ).trim().split("\n")

    const fixture = createCanonicalFocusModeFixture()
    const panes = fixture.panes.map((pane, index) => ({
      ...pane,
      paneId: paneIds[index],
    }))
    const sameProjectHiddenPane = panes.find((pane) => pane.id === fixture.sameProjectHiddenPane.id)!
    const otherProjectHiddenPane = panes.find((pane) => pane.id === fixture.otherProjectHiddenPane.id)!

    execSync(`tmux break-pane -d -s '${sameProjectHiddenPane.paneId}' -n '${sameProjectHiddenPane.id}'`, {
      stdio: "pipe",
    })
    execSync(`tmux break-pane -d -s '${otherProjectHiddenPane.paneId}' -n '${otherProjectHiddenPane.id}'`, {
      stdio: "pipe",
    })

    let currentPanes = panes.map((pane) => ({ ...pane }))
    const tmuxService = TmuxService.getInstance()

    const getCurrentWindowPaneIds = () =>
      execSync(`tmux list-panes -t ${session}:0 -F '#{pane_id}'`, {
        encoding: "utf-8",
        stdio: "pipe",
      }).trim().split("\n").filter(Boolean)

    const savePanes = async (updatedPanes: DmuxPane[]) => {
      currentPanes = updatedPanes.map((pane) => ({ ...pane }))
    }

    const loadPanes = async () => {}
    const refreshPaneLayout = async () => {}
    const getPaneShowTarget = async (excludedPaneId?: string) =>
      currentPanes.find((pane) => !pane.hidden && pane.paneId !== excludedPaneId)?.paneId || null

    await callback({
      panes: currentPanes.map((pane) => ({ ...pane })),
      getCurrentPanes: () => currentPanes.map((pane) => ({ ...pane })),
      getCurrentWindowPaneIds,
      buildDeps: () => ({
        panes: currentPanes.map((pane) => ({ ...pane })),
        tmuxService,
        getPaneShowTarget,
        savePanes,
        loadPanes,
        refreshPaneLayout,
      }),
      fixture: {
        ...fixture,
        panes: currentPanes.map((pane) => ({ ...pane })),
        selectedPane: currentPanes.find((pane) => pane.id === fixture.selectedPane.id)!,
        sameProjectVisiblePane: currentPanes.find((pane) => pane.id === fixture.sameProjectVisiblePane.id)!,
        sameProjectHiddenPane: currentPanes.find((pane) => pane.id === fixture.sameProjectHiddenPane.id)!,
        otherProjectVisiblePane: currentPanes.find((pane) => pane.id === fixture.otherProjectVisiblePane.id)!,
        otherProjectHiddenPane: currentPanes.find((pane) => pane.id === fixture.otherProjectHiddenPane.id)!,
      },
    })
  } finally {
    process.env.PATH = originalPath
    try {
      execSync(`"${realTmuxPath}" -L "${server}" kill-server`, { stdio: "pipe" })
    } catch {}
    try {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    } catch {}
  }
}

describe.sequential("paneVisibilityMutations tmux smoke", () => {
  it.runIf(canRun)("hides and shows a pane while keeping tmux topology and hidden state aligned", async () => {
    await withTmuxFixture(async ({ buildDeps, fixture, getCurrentPanes, getCurrentWindowPaneIds }) => {
      await applyPaneVisibilityToggle(buildDeps(), fixture.selectedPane)

      expect(getCurrentWindowPaneIds()).not.toContain(fixture.selectedPane.paneId)
      expect(
        getCurrentPanes().find((pane) => pane.id === fixture.selectedPane.id)?.hidden
      ).toBe(true)

      await applyPaneVisibilityToggle(
        buildDeps(),
        getCurrentPanes().find((pane) => pane.id === fixture.sameProjectHiddenPane.id)!
      )

      expect(getCurrentWindowPaneIds()).toContain(fixture.sameProjectHiddenPane.paneId)
      expect(
        getCurrentPanes().find((pane) => pane.id === fixture.sameProjectHiddenPane.id)?.hidden
      ).toBe(false)
    })
  }, 120000)

  it.runIf(canRun)("hides and shows other panes while preserving dmux hidden flags", async () => {
    await withTmuxFixture(async ({ buildDeps, fixture, getCurrentPanes, getCurrentWindowPaneIds }) => {
      await applyBulkVisibilityToggle(buildDeps(), fixture.selectedPane)

      expect(getCurrentWindowPaneIds()).toEqual([fixture.selectedPane.paneId])
      expect(
        getCurrentPanes().filter((pane) => !pane.hidden).map((pane) => pane.id)
      ).toEqual([fixture.selectedPane.id])

      await applyBulkVisibilityToggle(
        buildDeps(),
        getCurrentPanes().find((pane) => pane.id === fixture.selectedPane.id)!
      )

      expect(getCurrentWindowPaneIds()).toEqual(
        expect.arrayContaining([
          fixture.selectedPane.paneId,
          fixture.sameProjectVisiblePane.paneId,
          fixture.sameProjectHiddenPane.paneId,
          fixture.otherProjectVisiblePane.paneId,
          fixture.otherProjectHiddenPane.paneId,
        ])
      )
      expect(getCurrentPanes().every((pane) => pane.hidden !== true)).toBe(true)
    })
  }, 120000)

  it.runIf(canRun)("focuses one project and then restores all panes", async () => {
    await withTmuxFixture(async ({ buildDeps, fixture, getCurrentPanes, getCurrentWindowPaneIds }) => {
      await applyProjectVisibilityToggle(
        buildDeps(),
        fixture.selectedPane.projectRoot!,
        fixture.sessionProjectRoot
      )

      expect(getCurrentWindowPaneIds()).toEqual(
        expect.arrayContaining([
          fixture.selectedPane.paneId,
          fixture.sameProjectVisiblePane.paneId,
          fixture.sameProjectHiddenPane.paneId,
        ])
      )
      expect(getCurrentWindowPaneIds()).not.toContain(fixture.otherProjectVisiblePane.paneId)
      expect(
        getCurrentPanes().find((pane) => pane.id === fixture.otherProjectVisiblePane.id)?.hidden
      ).toBe(true)

      await applyProjectVisibilityToggle(
        buildDeps(),
        fixture.selectedPane.projectRoot!,
        fixture.sessionProjectRoot
      )

      expect(getCurrentWindowPaneIds()).toEqual(
        expect.arrayContaining([
          fixture.selectedPane.paneId,
          fixture.sameProjectVisiblePane.paneId,
          fixture.sameProjectHiddenPane.paneId,
          fixture.otherProjectVisiblePane.paneId,
          fixture.otherProjectHiddenPane.paneId,
        ])
      )
      expect(getCurrentPanes().every((pane) => pane.hidden !== true)).toBe(true)
    })
  }, 120000)

  it.runIf(!canRun)("skipped: tmux not available or DMUX_E2E is not enabled", () => {})
})
