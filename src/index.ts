import { runWorkflow } from "./workflow.js"
import type { Item } from "./types.js"
import { ask, close } from "./sim/human.js"

async function main() {
  console.log("\n  ╔════════════════════════════════════════╗")
  console.log("  ║   BeerEngineer2 — Simulation            ║")
  console.log("  ╚════════════════════════════════════════╝\n")

  const title       = await ask("  Idee (Titel):        ")
  const description = await ask("  Idee (Beschreibung): ")

  const item: Item = { id: "ITEM-0001", title, description }

  try {
    await runWorkflow(item)
  } catch (err) {
    console.error("\n  FEHLER:", (err as Error).message)
    process.exit(1)
  } finally {
    close()
  }
}

main()
