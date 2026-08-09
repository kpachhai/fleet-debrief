#!/usr/bin/env node
/**
 * npx entry point. Runs the TypeScript server through tsx, which is a runtime
 * dependency, so a checkout (or an installed package) needs no build step for
 * the API - only the UI is built. Flags: --port <n> overrides the port.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(here, "..", "server", "index.ts");

const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");

const env = { ...process.env };
const portFlag = process.argv.indexOf("--port");
if (portFlag !== -1 && process.argv[portFlag + 1]) {
  env.PORT = process.argv[portFlag + 1];
}

const child = spawn(process.execPath, [tsxCli, serverEntry], {
  stdio: "inherit",
  env,
});
child.on("exit", (code) => process.exit(code ?? 0));
