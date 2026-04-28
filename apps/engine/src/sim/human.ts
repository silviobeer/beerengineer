import * as readline from "node:readline"
import { getWorkflowIO, hasWorkflowIO } from "../core/io.js"

let fallback: readline.Interface | null = null
const fallbackInterface = (): readline.Interface => {
  fallback ??= readline.createInterface({ input: process.stdin, output: process.stdout })
  return fallback
}

export const ask = (prompt: string): Promise<string> => {
  if (hasWorkflowIO()) {
    return getWorkflowIO().ask(prompt)
  }
  return new Promise<string>(resolve => fallbackInterface().question(prompt, resolve))
}

export const close = (): void => {
  fallback?.close()
  fallback = null
}
