export function Metrics({
  criticalCount,
  openCount,
  totalCount,
  onlineCount,
  responderCount,
  revision,
}: {
  criticalCount: number;
  openCount: number;
  totalCount: number;
  onlineCount: number;
  responderCount: number;
  revision: number;
}) {
  return (
    <section className="metrics">
      <article>
        <span className="metric-icon critical">!</span>
        <div>
          <strong>{criticalCount}</strong>
          <small>Critical incidents</small>
        </div>
        <em>SEV 1</em>
      </article>
      <article>
        <span className="metric-icon active">↗</span>
        <div>
          <strong>{openCount}</strong>
          <small>Open incidents</small>
        </div>
        <em>{totalCount} total</em>
      </article>
      <article>
        <span className="metric-icon people">●</span>
        <div>
          <strong>{onlineCount}</strong>
          <small>Responders online</small>
        </div>
        <em>{responderCount} rostered</em>
      </article>
      <article>
        <span className="metric-icon revision">#</span>
        <div>
          <strong>{revision}</strong>
          <small>Event revision</small>
        </div>
        <em>Resumable stream</em>
      </article>
    </section>
  );
}
