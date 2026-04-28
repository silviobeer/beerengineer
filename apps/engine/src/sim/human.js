import * as readline from "node:readline";
import { getWorkflowIO, hasWorkflowIO } from "../core/io.js";
let fallback = null;
const fallbackInterface = () => {
    fallback ??= readline.createInterface({ input: process.stdin, output: process.stdout });
    return fallback;
};
export const ask = (prompt) => {
    if (hasWorkflowIO()) {
        return getWorkflowIO().ask(prompt);
    }
    return new Promise(resolve => fallbackInterface().question(prompt, resolve));
};
export const close = () => {
    fallback?.close();
    fallback = null;
};
