import { describe, expect, it } from "vitest"
import {
  withDmuxRuntimeHarness,
} from "./helpers/dmuxRuntimeHarness.js"

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForCondition(
  condition: () => Promise<boolean>,
  timeoutMs: number,
  description: string
) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (await condition()) {
      return
    }
    await sleep(200)
  }

  throw new Error(`Timed out waiting for ${description}`)
}

describe.sequential("dmux quit runtime e2e", () => {
  it.skip(
    "detaches only the tmux client that confirms quit",
    async () => {
      await withDmuxRuntimeHarness(async (harness) => {
        const repoA = await harness.createProject("repo-a")
        await harness.startDmux(repoA)

        const primaryClientTty = harness.getClientTarget()
        const primaryAfterOffset = await harness.markClientLog()

        const secondaryClient = await harness.attachAdditionalClient({
          id: "client-b",
        })
        await sleep(500)

        expect(await harness.listClientTargets()).toEqual(
          expect.arrayContaining([primaryClientTty, secondaryClient.targetClient])
        )

        await secondaryClient.sendInput("q")
        expect(await harness.listClientTargets()).toEqual(
          expect.arrayContaining([primaryClientTty, secondaryClient.targetClient])
        )

        await secondaryClient.sendInput("q")

        await waitForCondition(
          async () =>
            !(await harness.listClientTargets()).includes(secondaryClient.targetClient),
          10000,
          "the secondary client to detach"
        )

        const remainingClients = await harness.listClientTargets()
        expect(remainingClients).toContain(primaryClientTty)

        await harness.sendClientInput("?")
        await harness.waitForClientLog("Keyboard Shortcuts", 10000, primaryAfterOffset)
      })
    },
    120000
  )
})
