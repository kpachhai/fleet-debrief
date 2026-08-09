import { useEffect, useState } from "react";
import { fetchDiff, money, duration, type RunDiff, type DiffStep } from "../api.js";
import { compact } from "../format.js";

function Step({ step }: { step: DiffStep }) {
  return (
    <>
      <div>
        {step.excerpt || <span style={{ opacity: 0.5 }}>({step.type})</span>}
      </div>
      {step.toolUses.length > 0 && (
        <div className="tools">{step.toolUses.join(" · ")}</div>
      )}
    </>
  );
}

export function DiffView({
  a,
  b,
}: {
  a: { projectDir: string; sessionId: string };
  b: { projectDir: string; sessionId: string };
}) {
  const [diff, setDiff] = useState<RunDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDiff(null);
    setError(null);
    fetchDiff(a, b)
      .then(setDiff)
      .catch((err: Error) => setError(err.message));
  }, [a.projectDir, a.sessionId, b.projectDir, b.sessionId]);

  if (error) return <div className="empty">{error}</div>;
  if (!diff) return <div className="empty">aligning runs…</div>;

  const tokensOf = (t: RunDiff["deltas"]["tokens"]["a"]) =>
    t.input + t.output + t.cacheRead + t.cacheCreation;

  return (
    <>
      <div className="controls">
        <a href="#/">← debrief</a>
        <span className="hint">
          {Math.round(diff.similarity * 100)}% aligned
          {diff.truncated ? " · long runs truncated for alignment" : ""}
        </span>
      </div>

      <div className="totals">
        <div className="stat derived">
          <div className="label">cost A / B</div>
          <div className="value num">
            {money(diff.deltas.costUsd.a)} / {money(diff.deltas.costUsd.b)}
          </div>
        </div>
        <div className="stat">
          <div className="label">duration A / B</div>
          <div className="value num">
            {duration(diff.deltas.durationMs.a)} /{" "}
            {duration(diff.deltas.durationMs.b)}
          </div>
        </div>
        <div className="stat">
          <div className="label">tokens A / B</div>
          <div className="value num">
            {compact(tokensOf(diff.deltas.tokens.a))} /{" "}
            {compact(tokensOf(diff.deltas.tokens.b))}
          </div>
        </div>
        <div className="stat">
          <div className="label">subagent turns A / B</div>
          <div className="value num">
            {diff.deltas.sidechainTurns.a} / {diff.deltas.sidechainTurns.b}
          </div>
        </div>
      </div>

      {diff.deltas.tools.length > 0 && (
        <section className="project">
          <h2>tool-call deltas</h2>
          <table>
            <thead>
              <tr>
                <th>tool</th>
                <th className="right">A</th>
                <th className="right">B</th>
              </tr>
            </thead>
            <tbody>
              {diff.deltas.tools.map((tool) => (
                <tr key={tool.name}>
                  <td>{tool.name}</td>
                  <td className="right num">{tool.a}</td>
                  <td className="right num">{tool.b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {(diff.deltas.files.onlyA.length > 0 || diff.deltas.files.onlyB.length > 0) && (
        <section className="project">
          <h2>files touched by only one run</h2>
          <div className="diff-grid">
            <div className="diff-cell">
              {diff.deltas.files.onlyA.map((file) => (
                <div key={file}>{file}</div>
              ))}
            </div>
            <div className="diff-cell">
              {diff.deltas.files.onlyB.map((file) => (
                <div key={file}>{file}</div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="project">
        <h2>
          aligned timeline — A: “{diff.a.title}” · B: “{diff.b.title}”
        </h2>
        {diff.divergenceIndex === -1 ? (
          <p className="divergence-note">
            The two runs share their entire aligned structure.
          </p>
        ) : (
          <p className="divergence-note">
            ▼ runs diverge at step {diff.divergenceIndex + 1}
          </p>
        )}
        <div className="diff-grid">
          {diff.ops.map((op, index) => {
            const divergent = index === diff.divergenceIndex;
            const rowClass = divergent ? "diff-row-divergence" : "";
            if (op.kind === "same") {
              return (
                <div style={{ display: "contents" }} className={rowClass} key={index}>
                  <div className="diff-cell">
                    <Step step={op.a} />
                  </div>
                  <div className="diff-cell">
                    <Step step={op.b} />
                  </div>
                </div>
              );
            }
            if (op.kind === "a-only") {
              return (
                <div style={{ display: "contents" }} className={rowClass} key={index}>
                  <div className="diff-cell only">
                    <Step step={op.a} />
                  </div>
                  <div className="diff-cell gap" />
                </div>
              );
            }
            return (
              <div style={{ display: "contents" }} className={rowClass} key={index}>
                <div className="diff-cell gap" />
                <div className="diff-cell only">
                  <Step step={op.b} />
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
