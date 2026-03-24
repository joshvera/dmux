import { describe, expect, it } from "vitest"
import {
  canRunDmuxRuntimeE2E,
  type RuntimeTmuxClient,
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

function getClientKeyTable(clients: RuntimeTmuxClient[], tty: string): string | undefined {
  return clients.find((client) => client.tty === tty)?.keyTable
}

describe.sequential("dmux quit runtime e2e", () => {
  it.runIf(canRunDmuxRuntimeE2E)(
    "arms and confirms detach per tmux client without affecting other attached clients",
    async () => {
      await withDmuxRuntimeHarness(async (harness) => {
        const repoA = await harness.createProject("repo-a")
        await harness.startDmux(repoA)

        const primaryClientTty = harness.getClientTarget()
        const primaryAfterOffset = await harness.markClientLog()

        const secondaryClient = await harness.attachAdditionalClient({
          id: "client-b",
        })

        const initialClients = await harness.listClients()
        if (getClientKeyTable(initialClients, primaryClientTty) !== "root") {
          await harness.sendClientInput("Escape")
        }

        await waitForCondition(
          async () => {
            const clients = await harness.listClients()
            return (
              getClientKeyTable(clients, primaryClientTty) === "root"
              && getClientKeyTable(clients, secondaryClient.targetClient) === "root"
            )
          },
          10000,
          "both tmux clients to start in the root key table"
        )

        await secondaryClient.sendInput("q")

        await waitForCondition(
          async () => {
            const clients = await harness.listClients()
            return (
              getClientKeyTable(clients, primaryClientTty) === "root"
              && getClientKeyTable(clients, secondaryClient.targetClient) === "dmux-detach-confirm"
            )
          },
          10000,
          "the secondary client to enter detach confirmation mode"
        )

        await secondaryClient.sendInput("Escape")

        await waitForCondition(
          async () => {
            const clients = await harness.listClients()
            return (
              getClientKeyTable(clients, primaryClientTty) === "root"
              && getClientKeyTable(clients, secondaryClient.targetClient) === "root"
            )
          },
          10000,
          "the secondary client to cancel detach confirmation"
        )

        await secondaryClient.sendInput("q")

        await waitForCondition(
          async () => {
            const clients = await harness.listClients()
            return getClientKeyTable(clients, secondaryClient.targetClient) === "dmux-detach-confirm"
          },
          10000,
          "the secondary client to re-enter detach confirmation mode"
        )

        await secondaryClient.sendInput("?")

        await waitForCondition(
          async () => {
            const clients = await harness.listClients()
            return (
              getClientKeyTable(clients, primaryClientTty) === "root"
              && getClientKeyTable(clients, secondaryClient.targetClient) === "root"
            )
          },
          10000,
          "the secondary client to return to the root key table after passthrough"
        )

        await secondaryClient.sendInput("q")

        await waitForCondition(
          async () => {
            const clients = await harness.listClients()
            return getClientKeyTable(clients, secondaryClient.targetClient) === "dmux-detach-confirm"
          },
          10000,
          "the secondary client to arm detach confirmation again"
        )

        const detachAttemptOffset = await secondaryClient.markLog()
        await secondaryClient.sendInput("q")

        await waitForCondition(
          async () => {
            const clients = await harness.listClients()
            return (
              !clients.some((client) => client.tty === secondaryClient.targetClient)
              && getClientKeyTable(clients, primaryClientTty) === "root"
            )
          },
          10000,
          "the secondary client to detach while leaving the primary client attached"
        )

        expect((await secondaryClient.readLog()).slice(detachAttemptOffset)).not.toContain(
          "Can't find client: #{client_tty}"
        )

        await harness.sendClientInput("?")
        await harness.waitForClientLog("Keyboard Shortcuts", 10000, primaryAfterOffset)
      })
    },
    120000
  )

  it.runIf(!canRunDmuxRuntimeE2E)(
    "skipped: tmux/script/runner not available or DMUX_E2E is not enabled",
    () => {}
  )
})
