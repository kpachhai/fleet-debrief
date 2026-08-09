import { useEffect, useMemo, useState } from "react";
import {
  fetchDebrief,
  money,
  duration,
  timeOf,
  type Debrief,
  type DebriefSession,
} from "../api.js";
import { compact } from "../format.js";

const WINDOWS = [12, 24, 48, 168];

type Picked = { projectDir: string; sessionId: string };

export function DebriefView() {
  const [hours, setHours] = useState(24);
  const [debrief, setDebrief] = useState<Debrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked[]>([]);

  useEffect(() => {
    setDebrief(null);
    setError(null);
    fetchDebrief(hours)
      .then(setDebrief)
      .catch((err: Error) => setError(err.message));
  }, [hours]);

  const totalTokens = useMemo(() => {
    if (!debrief) return 0;
    const t = debrief.totals.tokens;
    return t.input + t.output + t.cacheRead + t.cacheCreation;
  }, [debrief]);

  const togglePick = (session: DebriefSession) => {
    const id: Picked = {
      projectDir: session.projectDir,
      sessionId: session.sessionId,
    };
    setPicked((current) => {
      const without = current.filter(
        (p) => !(p.projectDir === id.projectDir && p.sessionId === id.sessionId),
      );
      if (without.length !== current.length) return without;
      // Keep at most two: the diff is pairwise by definition.
      return [...current.slice(-1), id];
    });
  };

  const isPicked = (session: DebriefSession) =>
    picked.some(
      (p) =>
        p.projectDir === session.projectDir && p.sessionId === session.sessionId,
    );

  const diffHref =
    picked.length === 2
      ? `#/diff/${encodeURIComponent(picked[0].projectDir)}/${encodeURIComponent(picked[0].sessionId)}/` +
        `${encodeURIComponent(picked[1].projectDir)}/${encodeURIComponent(picked[1].sessionId)}`
      : null;

  if (error) return <div className="empty">{error}</div>;
  if (!debrief) return <div className="empty">reading transcripts…</div>;

  return (
    <>
      <div className="controls">
        {WINDOWS.map((w) => (
          <button
            key={w}
            className={w === hours ? "active" : ""}
            onClick={() => setHours(w)}
          >
            {w === 168 ? "7d" : `${w}h`}
          </button>
        ))}
        {diffHref ? (
          <a href={diffHref}>
            <button className="active">diff the two picked runs →</button>
          </a>
        ) : (
          <span className="picker-note">
            pick two runs (checkboxes) to diff them
          </span>
        )}
        <span className="hint">
          prices as of {debrief.pricingAsOf}
          {debrief.truncated ? " · window truncated, totals are a floor" : ""}
        </span>
      </div>

      <div className="totals">
        <div className="stat derived">
          <div className="label">cost ({debrief.sinceHours}h)</div>
          <div className="value num">
            {money(debrief.totals.costUsd)}
            {debrief.totals.unpricedModels.length > 0 && (
              <small> +unpriced: {debrief.totals.unpricedModels.join(", ")}</small>
            )}
          </div>
        </div>
        <div className="stat">
          <div className="label">sessions</div>
          <div className="value num">{debrief.totals.sessions}</div>
        </div>
        <div className="stat">
          <div className="label">tokens</div>
          <div className="value num">{compact(totalTokens)}</div>
        </div>
        <div className="stat">
          <div className="label">files touched</div>
          <div className="value num">
            {debrief.totals.filesTouched}
            <small>
              {" "}
              +{compact(debrief.totals.linesAdded)}/−
              {compact(debrief.totals.linesRemoved)}
            </small>
          </div>
        </div>
        <div className="stat">
          <div className="label">subagent turns</div>
          <div className="value num">{debrief.totals.sidechainTurns}</div>
        </div>
        <div className={debrief.totals.hookErrorRecords > 0 ? "stat bounded" : "stat"}>
          <div className="label">hook errors / denials</div>
          <div className="value num">
            {debrief.totals.hookErrorRecords} / {debrief.totals.toolDenials}
          </div>
        </div>
      </div>

      {debrief.projects.length === 0 && (
        <div className="empty">
          No sessions in the last {debrief.sinceHours}h under{" "}
          <code>~/.claude/projects</code>. Run something, then come back.
        </div>
      )}

      {debrief.projects.map((project) => (
        <section className="project" key={project.projectDir}>
          <h2>
            {project.cwd}
            <span className="cost num">{money(project.costUsd)}</span>
          </h2>
          <table>
            <thead>
              <tr>
                <th></th>
                <th>run</th>
                <th>ended</th>
                <th className="right">duration</th>
                <th className="right">turns</th>
                <th className="right">files</th>
                <th className="right">cost</th>
              </tr>
            </thead>
            <tbody>
              {project.sessions.map((session) => (
                <tr key={session.sessionId}>
                  <td>
                    <input
                      type="checkbox"
                      checked={isPicked(session)}
                      onChange={() => togglePick(session)}
                    />
                  </td>
                  <td>
                    <a
                      href={`#/session/${encodeURIComponent(session.projectDir)}/${encodeURIComponent(session.sessionId)}`}
                    >
                      {session.title}
                    </a>
                    {session.sidechainTurns > 0 && (
                      <span className="badge">
                        {session.sidechainTurns} subagent turns
                      </span>
                    )}
                    {session.hookErrorRecords > 0 && (
                      <span className="badge bad">
                        {session.hookErrorRecords} hook errors
                      </span>
                    )}
                    {session.toolDenials.length > 0 && (
                      <span className="badge warn">denials</span>
                    )}
                    {session.skippedLines > 0 && (
                      <span className="badge warn">
                        {session.skippedLines} unparsed
                      </span>
                    )}
                  </td>
                  <td className="num">{timeOf(session.endedAt)}</td>
                  <td className="right num">{duration(session.durationMs)}</td>
                  <td className="right num">{session.messageCount}</td>
                  <td className="right num">{session.filesTouched}</td>
                  <td className="right num">{money(session.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}
