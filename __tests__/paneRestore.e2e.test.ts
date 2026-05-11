import { describe, expect, it } from "vitest"
import * as fsp from "fs/promises"
import * as path from "path"
import type { DmuxConfig, DmuxPane } from "../src/types.js"
import {
  canRunDmuxRuntimeE2E,
  sleep,
  type DmuxRuntimeHarness,
  type RuntimeProject,
  withDmuxRuntimeHarness,
} from "./helpers/dmuxRuntimeHarness.js"

const RESTORED_PANE_ID = "dmux-restore-1"
const RESTORED_SLUG = "sota-wiggum"
const STALE_PANE_ID = "%999"
const PROMPT =
  "Let's review the SOTA of the wiggum pattern online and compare it to our repo"
const PROMPT_PREVIEW = `${PROMPT.substring(0, 50)}...`

function buildSeedPane(project: RuntimeProject, worktreePath: string): DmuxPane {
  return {
    id: RESTORED_PANE_ID,
    slug: RESTORED_SLUG,
    branchName: RESTORED_SLUG,
    prompt: PROMPT,
    paneId: STALE_PANE_ID,
    worktreePath,
    projectRoot: project.root,
    projectName: project.name,
    type: "worktree",
  }
}

async function seedStalePaneConfig(project: RuntimeProject): Promise<void> {
  const worktreePath = path.join(project.root, ".dmux", "worktrees", RESTORED_SLUG)
  await fsp.mkdir(worktreePath, { recursive: true })
  await fsp.writeFile(path.join(worktreePath, "README.md"), "# restored pane fixture\n", "utf-8")

  const config: DmuxConfig = {
    projectName: project.name,
    projectRoot: project.root,
    panes: [buildSeedPane(project, worktreePath)],
    sidebarProjects: [],
    settings: {
      presentationMode: "focus",
    },
    lastUpdated: new Date().toISOString(),
  }

  await fsp.writeFile(project.configPath, JSON.stringify(config, null, 2), "utf-8")
}

async function waitForRestoredPane(
  harness: DmuxRuntimeHarness,
  project: RuntimeProject,
  previousPaneId: string
): Promise<DmuxPane> {
  const config = await harness.waitForPaneState(
    project,
    (nextConfig) => {
      const pane = nextConfig.panes.find((candidate) => candidate.id === RESTORED_PANE_ID)
      return !!pane && pane.paneId.startsWith("%") && pane.paneId !== previousPaneId
    },
    `pane ${RESTORED_SLUG} to be restored`
  )

  const pane = config.panes.find((candidate) => candidate.id === RESTORED_PANE_ID)
  if (!pane) {
    throw new Error(`Restored pane ${RESTORED_PANE_ID} not found in config`)
  }
  return pane
}

async function waitForPaneCapture(
  harness: DmuxRuntimeHarness,
  paneId: string,
  predicate: (capture: string) => boolean,
  description: string,
  timeoutMs = 10000
): Promise<string> {
  const startedAt = Date.now()
  let lastCapture = ""

  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      lastCapture = await harness.readPaneCapture(paneId)
      if (predicate(lastCapture)) {
        return lastCapture
      }
    } catch {}

    await sleep(200)
  }

  throw new Error(`Timed out waiting for ${description}.\nLast capture:\n${lastCapture}`)
}

async function assertRestoredPaneIsUsable(
  harness: DmuxRuntimeHarness,
  paneId: string
): Promise<void> {
  const capture = await waitForPaneCapture(
    harness,
    paneId,
    (value) =>
      value.includes(`# Pane restored: ${RESTORED_SLUG}`)
      && value.includes(`# Original prompt: ${PROMPT_PREVIEW}`)
      && !value.includes("quote>"),
    `restored pane ${paneId} to show safe restore output`
  )

  expect(capture).toContain(`# Pane restored: ${RESTORED_SLUG}`)
  expect(capture).toContain(`# Original prompt: ${PROMPT_PREVIEW}`)
  expect(capture).not.toContain("quote>")

  await harness.selectPaneDirect(paneId, { preserveZoom: true })
  await harness.openFocusNavigatorFromActivePane()
  await harness.sendClientInput("Escape")
  await sleep(200)
}

async function withFreshRuntimeHarness(
  callback: (harness: DmuxRuntimeHarness) => Promise<void>
): Promise<void> {
  const previousRunner = process.env.DMUX_E2E_RUNNER
  process.env.DMUX_E2E_RUNNER = "pnpm-build-dist"

  try {
    await withDmuxRuntimeHarness(callback)
  } finally {
    if (previousRunner === undefined) {
      delete process.env.DMUX_E2E_RUNNER
    } else {
      process.env.DMUX_E2E_RUNNER = previousRunner
    }
  }
}

describe.sequential("pane restore runtime e2e", () => {
  it.runIf(canRunDmuxRuntimeE2E)("restores apostrophe-bearing prompts without leaving the shell in quote mode", async () => {
    await withFreshRuntimeHarness(async (harness) => {
      const project = await harness.createProject("repo-a", {
        presentationMode: "focus",
      })
      await seedStalePaneConfig(project)

      await harness.startDmux(project)

      const restoredPane = await waitForRestoredPane(harness, project, STALE_PANE_ID)
      await assertRestoredPaneIsUsable(harness, restoredPane.paneId)

      await harness.sendPaneCommand(restoredPane.paneId, "exit")

      const recreatedPane = await waitForRestoredPane(harness, project, restoredPane.paneId)
      expect(recreatedPane.paneId).not.toBe(restoredPane.paneId)
      await assertRestoredPaneIsUsable(harness, recreatedPane.paneId)
    })
  }, 120000)

  it.runIf(!canRunDmuxRuntimeE2E)("skipped: tmux/script/runner not available or DMUX_E2E is not enabled", () => {})
})
