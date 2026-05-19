import * as fsp from "fs/promises"
import * as os from "os"
import * as path from "path"
import { describe, expect, it } from "vitest"
import {
  canRunDmuxRuntimeE2E,
  sleep,
  withDmuxRuntimeHarness,
} from "./helpers/dmuxRuntimeHarness.js"
import {
  cleanupPerfScratchDir,
  loadPerfInstance,
  recordNavigationWindow,
  requireAtLeast,
  requireNoCoreMissingMetrics,
  requireStressWindowSample,
  seedTrackedCodexPanes,
} from "./helpers/dmuxPerfStressHarness.js"
import type { PerfInstanceSummary } from "../src/utils/perfReport.js"

const INSTANCE_LABEL = "agent-stress"
const TRANSPORT = "runtime-harness"
const INPUTS_PER_WINDOW = 56
const MIN_HANDLED_VISIBLE_INPUTS = 50
const MIN_MATCHED_KEY_TO_RENDER = 30
const AGENT_PANE_COUNT = 3

describe.sequential("dmux perf stress e2e", () => {
  it.runIf(canRunDmuxRuntimeE2E)(
    "collects real dmux samples while fake Codex panes are idle and then bursty",
    async () => {
      const scratchDir = await fsp.mkdtemp(path.join(os.tmpdir(), "dmux-perf-stress-"))
      const perfDir = path.join(scratchDir, "perf")
      const profileFile = path.join(scratchDir, "fake-codex-profile")
      const runId = `agent-stress-${Date.now()}`
      let succeeded = false

      try {
        await fsp.mkdir(perfDir, { recursive: true })
        await fsp.writeFile(profileFile, "idle")

        await withDmuxRuntimeHarness(
          async (harness) => {
            await harness.writeExecutable("codex", fakeCodexScript())
            const project = await harness.createProject("repo-a", {
              settings: {
                defaultAgent: "codex",
                enabledAgents: ["codex"],
                permissionMode: "bypassPermissions",
                promptForGitOptionsOnCreate: false,
                presentationMode: "focus",
                useTmuxHooks: false,
              },
            })

            await harness.startDmux(project)
            const secondClient = await harness.attachAdditionalClient({ id: "observer" })
            expect(secondClient.targetClient).toBeTruthy()
            expect(await harness.listClients()).toHaveLength(2)

            await seedTrackedCodexPanes(harness, project, {
              count: AGENT_PANE_COUNT,
              idPrefix: "dmux-stress",
              slugPrefix: "stress-codex",
              permissionMode: "bypassPermissions",
              promptForIndex: (index) => `DMUX_FAKE_CODEX_STRESS pane ${index + 1}`,
            })

            await sleep(4500)
            await recordNavigationWindow({
              harness,
              perfDir,
              runId,
              instanceLabel: INSTANCE_LABEL,
              transport: TRANSPORT,
              label: "idle-navigation",
              inputCount: INPUTS_PER_WINDOW,
            })

            await fsp.writeFile(profileFile, "burst")
            await sleep(4500)
            await recordNavigationWindow({
              harness,
              perfDir,
              runId,
              instanceLabel: INSTANCE_LABEL,
              transport: TRANSPORT,
              label: "burst-navigation",
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
              DMUX_FAKE_CODEX_PROFILE_FILE: profileFile,
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
        requireWindowSample(instance, "idle-navigation", report)
        requireWindowSample(instance, "burst-navigation", report)
        succeeded = true
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`${message}\nPerf artifacts: ${perfDir}`)
      } finally {
        await cleanupPerfScratchDir({ succeeded, scratchDir, perfDir })
      }
    },
    240000
  )

  it.runIf(!canRunDmuxRuntimeE2E)("skipped: tmux/script/runner not available or DMUX_E2E is not enabled", () => {})
})

function fakeCodexScript(): string {
  return `#!/bin/sh
profile_file="\${DMUX_FAKE_CODEX_PROFILE_FILE:-}"
i=0
trap 'exit 0' INT TERM HUP
printf 'fake codex started: %s\\n' "$*"
while :; do
  profile="steady"
  if [ -n "$profile_file" ] && [ -f "$profile_file" ]; then
    profile="$(cat "$profile_file" 2>/dev/null || printf steady)"
  fi

  case "$profile" in
    idle)
      i=$((i + 1))
      printf 'fake codex idle %s waiting for input\\n' "$i"
      sleep 1
      ;;
    burst)
      i=$((i + 1))
      n=0
      while [ "$n" -lt 30 ]; do
        printf 'fake codex burst %s.%s working analyzing streaming output\\n' "$i" "$n"
        n=$((n + 1))
      done
      sleep 0.15
      ;;
    *)
      i=$((i + 1))
      printf 'fake codex steady %s working\\n' "$i"
      sleep 0.35
      ;;
  esac
done
`
}

function requireCoreSample(instance: PerfInstanceSummary, report: string): void {
  requireAtLeast(instance.handledVisibleInputCount, MIN_HANDLED_VISIBLE_INPUTS * 2, "handled visible inputs", report)
  requireAtLeast(instance.handledKeyToRender.count, MIN_MATCHED_KEY_TO_RENDER * 2, "handled key-to-render samples", report)
  requireAtLeast(instance.tmuxCommand.count, 1, "tmux command samples", report)
  requireAtLeast(instance.tmuxCommandBreakdown.length, 1, "tmux command breakdown rows", report)
  requireAtLeast(instance.workerCapture.count, AGENT_PANE_COUNT, "worker capture samples", report)
  requireAtLeast(instance.workerCaptureBreakdown.length, AGENT_PANE_COUNT, "worker capture breakdown rows", report)
  requireAtLeast(instance.renderCount, 1, "render samples", report)

  if (instance.metadata.workerCount !== AGENT_PANE_COUNT) {
    throw new Error(`Expected workerCount=${AGENT_PANE_COUNT}, got ${String(instance.metadata.workerCount)}\n\n${report}`)
  }

  requireNoCoreMissingMetrics(instance, report, "Stress")
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
