import * as readline from "readline"

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

export const ask = (prompt: string): Promise<string> =>
  new Promise(resolve => rl.question(prompt, resolve))

export const close = (): void => rl.close()
