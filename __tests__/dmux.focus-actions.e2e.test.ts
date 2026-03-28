import { describe, expect, it } from "vitest"
import * as fs from "fs"
import type { DmuxConfig, DmuxPane } from "../src/types.js"
import {
  canRunDmuxRuntimeE2E,
  type DmuxRuntimeHarness,
  type RuntimeProject,
  withDmuxRuntimeHarness,
} from "./helpers/dmuxRuntimeHarness.js"

function normalizeProjectRoot(projectRoot: string): string {
  try {
    return fs.realpathSync.native(projectRoot)
  } catch {
    return projectRoot
  }
}

function getProjectPanes(config: DmuxConfig, projectRoot: string): DmuxPane[] {
  const normalizedProjectRoot = normalizeProjectRoot(projectRoot)
  return config.panes.filter(
    (pane) => normalizeProjectRoot(pane.projectRoot) === normalizedProjectRoot
  )
}

function getVisibleProjectPanes(config: DmuxConfig, projectRoot: string): DmuxPane[] {
  return getProjectPanes(config, projectRoot).filter((pane) => pane.hidden !== true)
}

function getHiddenProjectPanes(config: DmuxConfig, projectRoot: string): DmuxPane[] {
  return getProjectPanes(config, projectRoot).filter((pane) => pane.hidden === true)
}

function getNewestPane(config: DmuxConfig, projectRoot: string): DmuxPane {
  const pane = [...getProjectPanes(config, projectRoot)].reverse()[0]
  if (!pane) {
    throw new Error(`No panes found for ${projectRoot}`)
  }
  return pane
}

async function openPaneMenuForActivePane(harness: DmuxRuntimeHarness) {
  await harness.openPaneMenuFromActivePane()
}

async function seedFocusFixture(harness: DmuxRuntimeHarness): Promise<{
  repoA: RuntimeProject
  repoB: RuntimeProject
  config: DmuxConfig
}> {
  const repoA = await harness.createProject("repo-a", {
    presentationMode: "focus",
  })
  const repoB = await harness.createProject("repo-b", {
    presentationMode: "focus",
  })

  await harness.startDmux(repoA)

  let config = await harness.waitForPaneCount(repoA, 0)

  for (let expectedCount = 1; expectedCount <= 3; expectedCount += 1) {
    await harness.sendControlInput("t")
    config = await harness.waitForPaneCount(repoA, expectedCount)
  }

  await openPaneMenuForActivePane(harness)
  await harness.sendClientInput("h")
  const repoAHiddenCandidate = getNewestPane(config, repoA.root)
  config = await harness.waitForPaneState(
    repoA,
    (nextConfig) =>
      nextConfig.panes.find((pane) => pane.id === repoAHiddenCandidate.id)?.hidden === true,
    "repo-a hidden pane"
  )

  const attachPane = getVisibleProjectPanes(config, repoA.root)[0]
  await harness.attachProject(repoB, { paneId: attachPane.paneId })
  config = await harness.waitForPaneState(
    repoA,
    (nextConfig) =>
      nextConfig.sidebarProjects?.some(
        (sidebarProject) =>
          normalizeProjectRoot(sidebarProject.projectRoot) === normalizeProjectRoot(repoB.root)
      ) === true,
    "repo-b sidebar project"
  )

  const repoBPaneId = await harness.splitPaneDirect({ cwd: repoB.root })
  config = await harness.waitForPaneState(
    repoA,
    (nextConfig) => getProjectPanes(nextConfig, repoB.root).length === 1,
    "first repo-b pane to be detected"
  )
  await harness.selectPaneDirect(repoBPaneId)

  const repoBSecondPaneId = await harness.splitPaneDirect({
    cwd: repoB.root,
    targetPaneId: repoBPaneId,
  })
  config = await harness.waitForPaneState(
    repoA,
    (nextConfig) => getProjectPanes(nextConfig, repoB.root).length === 2,
    "second repo-b pane to be created"
  )
  await harness.selectPaneDirect(repoBSecondPaneId)

  await openPaneMenuForActivePane(harness)
  await harness.sendClientInput("h")
  const repoBHiddenCandidate = getNewestPane(config, repoB.root)
  config = await harness.waitForPaneState(
    repoA,
    (nextConfig) =>
      nextConfig.panes.find((pane) => pane.id === repoBHiddenCandidate.id)?.hidden === true,
    "repo-b hidden pane"
  )

  expect(getVisibleProjectPanes(config, repoA.root)).toHaveLength(2)
  expect(getHiddenProjectPanes(config, repoA.root)).toHaveLength(1)
  expect(getVisibleProjectPanes(config, repoB.root)).toHaveLength(1)
  expect(getHiddenProjectPanes(config, repoB.root)).toHaveLength(1)

  return { repoA, repoB, config }
}

async function getVisibleWorkPaneIdsInMainWindow(
  harness: DmuxRuntimeHarness,
  config: DmuxConfig
): Promise<string[]> {
  const paneSnapshots = await harness.getPaneSnapshots()
  return paneSnapshots
    .filter((pane) => pane.sessionName === harness.sessionName && pane.windowIndex === 0)
    .map((pane) => pane.paneId)
    .filter((paneId) => config.panes.some((pane) => pane.paneId === paneId))
}

describe.sequential("dmux focus actions runtime e2e", () => {
  it.runIf(canRunDmuxRuntimeE2E)("keeps a hidden pane hidden in focus mode and moves focus to a visible fallback", async () => {
    await withDmuxRuntimeHarness(async (harness) => {
      const { repoA, config: seededConfig } = await seedFocusFixture(harness)
      const activePaneBefore = await harness.getActivePaneId()
      const activePane = seededConfig.panes.find((pane) => pane.paneId === activePaneBefore)
      expect(activePane?.projectRoot).toBeTruthy()

      await openPaneMenuForActivePane(harness)
      await harness.sendClientInput("h")

      const updatedConfig = await harness.waitForPaneState(
        repoA,
        (config) =>
          config.panes.find((pane) => pane.id === activePane?.id)?.hidden === true,
        "active pane to become hidden"
      )

      expect(updatedConfig.panes.find((pane) => pane.id === activePane?.id)?.hidden).toBe(true)
      expect(await harness.getActivePaneId()).not.toBe(activePane?.paneId)
    })
  }, 120000)

  it.runIf(canRunDmuxRuntimeE2E)("shows all other panes from the pane menu after hiding them", async () => {
    await withDmuxRuntimeHarness(async (harness) => {
      const { repoA, config: seededConfig } = await seedFocusFixture(harness)
      const activePaneId = await harness.getActivePaneId()
      const activePane = seededConfig.panes.find((pane) => pane.paneId === activePaneId)!

      await openPaneMenuForActivePane(harness)
      await harness.sendClientInput("H")
      await harness.waitForPaneState(
        repoA,
        (config) =>
          config.panes.filter((pane) => !pane.hidden).length === 1
          && config.panes.find((pane) => pane.id === activePane.id)?.hidden !== true,
        "other panes to hide"
      )

      await openPaneMenuForActivePane(harness)
      await harness.sendClientInput("H")

      const updatedConfig = await harness.waitForPaneState(
        repoA,
        (config) => config.panes.every((pane) => pane.hidden !== true),
        "all panes to become visible"
      )

      expect(updatedConfig.panes.every((pane) => pane.hidden !== true)).toBe(true)
      expect(await getVisibleWorkPaneIdsInMainWindow(harness, updatedConfig)).toEqual(
        expect.arrayContaining(updatedConfig.panes.map((pane) => pane.paneId))
      )
      expect(activePane.paneId).toBe(await harness.getActivePaneId())
    })
  }, 120000)

  it.runIf(canRunDmuxRuntimeE2E)("shows only the selected project and hides panes from other projects", async () => {
    await withDmuxRuntimeHarness(async (harness) => {
      const { repoA, repoB } = await seedFocusFixture(harness)

      await openPaneMenuForActivePane(harness)
      await harness.sendClientInput("P")

      const updatedConfig = await harness.waitForPaneState(
        repoA,
        (config) =>
          getVisibleProjectPanes(config, repoA.root).length === 3
          && getVisibleProjectPanes(config, repoB.root).length === 0,
        "focus project visibility update"
      )

      expect(getVisibleProjectPanes(updatedConfig, repoA.root)).toHaveLength(3)
      expect(getHiddenProjectPanes(updatedConfig, repoA.root)).toHaveLength(0)
      expect(getVisibleProjectPanes(updatedConfig, repoB.root)).toHaveLength(0)
      expect(getHiddenProjectPanes(updatedConfig, repoB.root)).toHaveLength(2)
      expect(await getVisibleWorkPaneIdsInMainWindow(harness, updatedConfig)).toEqual(
        expect.arrayContaining(
          getProjectPanes(updatedConfig, repoA.root).map((pane) => pane.paneId)
        )
      )
    })
  }, 120000)

  it.runIf(!canRunDmuxRuntimeE2E)("skipped: tmux/script/runner not available or DMUX_E2E is not enabled", () => {})
})
