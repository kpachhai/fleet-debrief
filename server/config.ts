import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/**
 * Minimal configuration. fleet-debrief is zero-config by design: everything it
 * reads lives where Claude Code already writes it, derived from $HOME. A
 * config.json exists only for the unusual machine (a relocated CLAUDE_CONFIG_DIR,
 * a nonstandard port), and its absence is the normal case, not a degraded one.
 */

export type AppConfig = {
  /** HTTP port for the local UI + API. */
  port: number;
  /** Claude Code session transcripts, `~/.claude/projects`. */
  transcriptsDir: string;
};

/** Expand a leading `~/` to the operator's home directory. */
export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * Raised when a data source's path does not exist. The route layer answers it
 * as a 503 naming the path, so "not configured" reads differently from
 * "broken" everywhere.
 */
export class SourceMissingError extends Error {
  readonly source: string;
  readonly missingPath: string;
  constructor(source: string, missingPath: string) {
    super(`source missing: ${source} (${missingPath})`);
    this.source = source;
    this.missingPath = missingPath;
  }
}

/** Repo root, resolved from this module rather than the shell's directory. */
export const APP_ROOT = path.resolve(import.meta.dirname, "..");

const DEFAULT_PORT = 7317;

function defaultTranscriptsDir(): string {
  // Respect a relocated Claude config dir when the operator has one.
  const configDir = process.env.CLAUDE_CONFIG_DIR
    ? expandHome(process.env.CLAUDE_CONFIG_DIR)
    : path.join(os.homedir(), ".claude");
  return path.join(configDir, "projects");
}

/**
 * Load config.json when present; otherwise derive everything from $HOME.
 * An unreadable or invalid config file fails loudly - a wrong config should
 * crash, not degrade quietly.
 */
export function loadConfig(configPath?: string): AppConfig {
  const config: AppConfig = {
    port: DEFAULT_PORT,
    transcriptsDir: defaultTranscriptsDir(),
  };

  const filePath = configPath ?? process.env.CONFIG_PATH ?? "config.json";
  if (fs.existsSync(filePath)) {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<
      string,
      unknown
    >;
    if (typeof raw.port === "number" && Number.isInteger(raw.port)) {
      config.port = raw.port;
    }
    if (typeof raw.transcriptsDir === "string" && raw.transcriptsDir.length > 0) {
      config.transcriptsDir = expandHome(raw.transcriptsDir);
    }
  }

  const envPort = process.env.PORT;
  if (envPort) {
    const parsed = Number(envPort);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
      throw new Error(`invalid PORT: ${envPort}`);
    }
    config.port = parsed;
  }

  return config;
}
