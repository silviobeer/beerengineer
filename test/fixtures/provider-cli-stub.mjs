import { readFileSync, writeFileSync } from "node:fs";

const output = process.env.STUB_OUTPUT ?? "{}";
const recordPath = process.env.STUB_RECORD_FILE;
const stdin = readFileSync(0, "utf8");
const exitCode = Number(process.env.STUB_EXIT_CODE ?? "0");

if (recordPath) {
  writeFileSync(
    recordPath,
    JSON.stringify(
      {
        argv: process.argv.slice(2),
        cwd: process.cwd(),
        stdin
      },
      null,
      2
    ),
    "utf8"
  );
}

const outputLastMessageIndex = process.argv.indexOf("--output-last-message");
if (outputLastMessageIndex >= 0 && process.argv[outputLastMessageIndex + 1]) {
  writeFileSync(process.argv[outputLastMessageIndex + 1], output, "utf8");
} else {
  process.stdout.write(output);
}
if (exitCode !== 0) {
  process.stderr.write(process.env.STUB_STDERR ?? "stubbed failure");
}
process.exit(exitCode);
