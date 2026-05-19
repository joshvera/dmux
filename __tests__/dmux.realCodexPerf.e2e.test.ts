import * as fsp from "fs/promises"
import * as os from "os"
import * as path from "path"
import { describe, it } from "vitest"
import {
  canRunDmuxRuntimeE2E,
  hasCommand,
  sleep,
  withDmuxRuntimeHarness,
} from "./helpers/dmuxRuntimeHarness.js"
import {
  cleanupPerfScratchDir,
  commandOutput,
  loadPerfInstance,
  readBoundedIntegerEnv,
  recordNavigationWindow,
  requireAtLeast,
  requireNoCoreMissingMetrics,
  requireStressWindowSample,
  seedTrackedCodexPanes,
} from "./helpers/dmuxPerfStressHarness.js"
import type { PerfInstanceSummary } from "../src/utils/perfReport.js"

const INSTANCE_LABEL = "real-codex-stress"
const TRANSPORT = "runtime-harness"
const INPUTS_PER_WINDOW = 44
const MIN_HANDLED_VISIBLE_INPUTS = 36
const MIN_MATCHED_KEY_TO_RENDER = 24
const REAL_CODEX_PANE_COUNT = readBoundedIntegerEnv("DMUX_E2E_REAL_CODEX_PANES", 2, 1, 4)
const canRunRealCodex =
  canRunDmuxRuntimeE2E &&
  process.env.DMUX_E2E_REAL_CODEX === "1" &&
  hasCommand("codex")

describe.sequential("dmux real Codex perf e2e", () => {
  it.runIf(canRunRealCodex)(
    "collects dmux samples while real Codex agent panes are active",
    async () => {
      const scratchDir = await fsp.mkdtemp(path.join(os.tmpdir(), "dmux-real-codex-perf-"))
      const perfDir = path.join(scratchDir, "perf")
      const runId = `real-codex-stress-${Date.now()}`
      const realCodexPath = commandOutput("command -v codex")
      let succeeded = false

      try {
        await fsp.mkdir(perfDir, { recursive: true })

        await withDmuxRuntimeHarness(
          async (harness) => {
            await harness.writeExecutable("codex", realCodexShim())
            const project = await harness.createProject("repo-a", {
              settings: {
                defaultAgent: "codex",
                enabledAgents: ["codex"],
                permissionMode: "plan",
                promptForGitOptionsOnCreate: false,
                presentationMode: "focus",
                useTmuxHooks: false,
              },
            })

            await harness.startDmux(project)
            await seedTrackedCodexPanes(harness, project, {
              count: REAL_CODEX_PANE_COUNT,
              idPrefix: "dmux-real-codex",
              slugPrefix: "real-codex",
              permissionMode: "plan",
              waitTimeoutMs: 20000,
              promptForIndex: (index) =>
                [
                  `DMUX_REAL_CODEX_STRESS pane ${index + 1}.`,
                  "Read-only latency exercise.",
                  "Inspect the repository briefly, do not edit files, and keep the session open for further instruction.",
                ].join(" "),
            })

            await sleep(10000)
            await recordNavigationWindow({
              harness,
              perfDir,
              runId,
              instanceLabel: INSTANCE_LABEL,
              transport: TRANSPORT,
              label: "real-codex-active",
              inputCount: INPUTS_PER_WINDOW,
            })
          },
          {
            env: {
              DMUX_PERF: "1",
              DMUX_PERF_DIR: perfDir,
              DMUX_PERF_RUN_ID: runId,
              DMUX_PERF_INSTANCE: INSTANCE_LABEL,
              DMUX_PERF_TRANSPORT: TRANSPORT,
              DMUX_REAL_CODEX_PATH: realCodexPath,
              DMUX_REAL_CODEX_AUTH_HOME:
                process.env.DMUX_REAL_CODEX_AUTH_HOME || process.env.HOME || "",
            },
          }
        )

        const { instance, report } = await loadPerfInstance({
          perfDir,
          runId,
          instanceLabel: INSTANCE_LABEL,
          transport: TRANSPORT,
        })
        await fsp.writeFile(path.join(perfDir, "perf-report.txt"), report)
        requireCoreSample(instance, report)
        requireWindowSample(instance, "real-codex-active", report)
        succeeded = true
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`${message}\nPerf artifacts: ${perfDir}`)
      } finally {
        await cleanupPerfScratchDir({ succeeded, scratchDir, perfDir })
      }
    },
    300000
  )

  it.runIf(!canRunRealCodex)(
    "skipped: set DMUX_E2E=1 DMUX_E2E_REAL_CODEX=1 with tmux, a dmux runner, and codex on PATH",
    () => {}
  )
})

function realCodexShim(): string {
  return `#!/bin/sh
if [ -n "\${DMUX_REAL_CODEX_AUTH_HOME:-}" ]; then
  HOME="$DMUX_REAL_CODEX_AUTH_HOME"
  export HOME
fi
exec "$DMUX_REAL_CODEX_PATH" "$@"
`
}

function requireCoreSample(instance: PerfInstanceSummary, report: string): void {
  requireAtLeast(instance.handledVisibleInputCount, MIN_HANDLED_VISIBLE_INPUTS, "handled visible inputs", report)
  requireAtLeast(instance.handledKeyToRender.count, MIN_MATCHED_KEY_TO_RENDER, "handled key-to-render samples", report)
  requireAtLeast(instance.tmuxCommand.count, 1, "tmux command samples", report)
  requireAtLeast(instance.tmuxCommandBreakdown.length, 1, "tmux command breakdown rows", report)
  requireAtLeast(instance.workerCapture.count, REAL_CODEX_PANE_COUNT, "worker capture samples", report)
  requireAtLeast(instance.workerCaptureBreakdown.length, 1, "worker capture breakdown rows", report)

  if ((instance.metadata.workerCount || 0) < REAL_CODEX_PANE_COUNT) {
    throw new Error(
      `Expected workerCount >= ${REAL_CODEX_PANE_COUNT}, got ${String(instance.metadata.workerCount)}\n\n${report}`
    )
  }

  requireNoCoreMissingMetrics(instance, report, "Real Codex")
}

function requireWindowSample(
  instance: PerfInstanceSummary,
  label: string,
  report: string
): void {
  requireStressWindowSample(
    instance,
    label,
    {
      handledVisibleInputCount: MIN_HANDLED_VISIBLE_INPUTS,
      matchedKeyToRenderCount: MIN_MATCHED_KEY_TO_RENDER,
      renderCount: MIN_MATCHED_KEY_TO_RENDER,
    },
    report
  )
}
