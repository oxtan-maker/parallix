/**
 * The minimal browser shell (ADR 0054 phase 1). Board data retrieval,
 * mutations, and workflows arrive in later missions over the validated
 * loopback adapter; this shell only proves the self-contained React/React
 * DOM build and the host's asset serving boundary.
 */
export function Shell() {
  return (
    <main className="shell">
      <h1>Parallix web board</h1>
      <p>Local loopback shell. Board data and mutations arrive in a later mission (ADR 0054).</p>
    </main>
  );
}
