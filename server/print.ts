import { pathToFileURL } from "node:url";
import { loadConfigOrExit, SourceMissingError } from "./config.js";
import { buildDebrief, type Debrief } from "./debrief.js";

/**
 * The debrief as terminal output, for people who would rather not open a browser
 * to answer "what did my agents do last night".
 *
 * Deliberately colourless. Output like this gets piped into `grep`, pasted into
 * an issue, and redirected to a file, and escape codes survive all three as
 * garbage - which is the same bug this project strips out of transcripts on the
 * way in. Alignment does the work colour would.
 */

function money(usd: number | null): string {
  return usd === null ? "     -" : `$${usd.toFixed(2)}`;
}

/** Same rule as the UI: days only once they read better than hours. */
function hoursLabel(hours: number): string {
  return hours % 24 === 0 && hours >= 72 ? `${hours / 24}d` : `${hours}h`;
}

function durationLabel(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** Shorten a project directory to something that fits a terminal line. */
function projectLabel(projectDir: string, cwd: string): string {
  const source = cwd || projectDir;
  const parts = source.split("/").filter(Boolean);
  return parts.slice(-2).join("/") || source;
}

export function formatDebrief(debrief: Debrief): string {
  const lines: string[] = [];
  const window = hoursLabel(debrief.sinceHours);
  const totals = debrief.totals;

  lines.push(
    `last ${window}   ${totals.sessions} run${totals.sessions === 1 ? "" : "s"}   ` +
      `${money(totals.costUsd)}   ${totals.filesTouched} file${totals.filesTouched === 1 ? "" : "s"} ` +
      `(+${totals.linesAdded}/-${totals.linesRemoved})`,
  );
  lines.push(`prices as of ${debrief.pricingAsOf}`);

  if (totals.sessions === 0) {
    lines.push("");
    lines.push(`No sessions in the last ${window}. Try a wider window: --since 7d`);
    return lines.join("\n");
  }

  lines.push("");
  for (const project of debrief.projects) {
    lines.push(`${projectLabel(project.projectDir, project.cwd)}   ${money(project.costUsd)}`);
    for (const session of project.sessions) {
      // A leading marker beats a colour: it survives grep and copy-paste.
      const flag = session.attentionScore > 0 ? "!" : " ";
      const title = session.title.replace(/\s+/g, " ").slice(0, 58);
      lines.push(
        `  ${flag} ${durationLabel(session.durationMs).padStart(7)}  ` +
          `${String(session.messageCount).padStart(4)} turns  ` +
          `${String(session.filesTouched).padStart(3)} files  ` +
          `${money(session.costUsd).padStart(9)}   ${title}`,
      );
    }
    lines.push("");
  }

  const notes: string[] = [];
  if (totals.hookErrorRecords > 0) notes.push(`${totals.hookErrorRecords} hook errors`);
  if (totals.toolDenials > 0) notes.push(`${totals.toolDenials} tool denials`);
  if (totals.skippedLines > 0) notes.push(`${totals.skippedLines} unparseable records`);
  if (notes.length > 0) {
    lines.push(`runs marked ! need a look: ${notes.join(", ")}`);
  }
  if (totals.unpricedModels.length > 0) {
    lines.push(
      `cost is a floor: no price on file for ${totals.unpricedModels.join(", ")}`,
    );
  }
  if (debrief.truncated) {
    lines.push(
      "window hit the file cap, so these totals are a floor - narrow it with --since",
    );
  }

  return lines.join("\n").replace(/\n+$/, "");
}

function main(): void {
  const config = loadConfigOrExit();
  try {
    const debrief = buildDebrief(config.transcriptsDir, config.defaultHours);
    process.stdout.write(`${formatDebrief(debrief)}\n`);
  } catch (error) {
    if (error instanceof SourceMissingError) {
      // Not a crash: a machine that has never run Claude Code has nothing to
      // read, and saying so beats a stack trace.
      process.stderr.write(
        `fleet-debrief: no transcripts found at ${error.missingPath}\n` +
          "If Claude Code stores them elsewhere, set CLAUDE_CONFIG_DIR.\n",
      );
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

// Only run when this file IS the command. Without the guard, importing
// formatDebrief from a test would print a real debrief as a side effect of the
// import and read the operator's actual transcripts to do it.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main();
}
