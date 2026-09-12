import { initials, type Responder } from '../model.js';

export function Sidebar({
  responders,
  openCount,
  totalCount,
  statusFilter,
  setStatusFilter,
}: {
  responders: Responder[];
  openCount: number;
  totalCount: number;
  statusFilter: string;
  setStatusFilter(value: string): void;
}) {
  const activeResponders = responders.filter((responder) => responder.online);
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">P</span>
        <div>
          <strong>Pulseboard</strong>
          <small>Incident operations</small>
        </div>
      </div>

      <nav>
        <p className="nav-label">Command center</p>
        <button
          className={`nav-item ${statusFilter === 'open' ? 'active' : ''}`}
          onClick={() => setStatusFilter('open')}
        >
          <span className="nav-icon">⌁</span>
          Active incidents
          <b>{openCount}</b>
        </button>
        <button
          className={`nav-item ${statusFilter === 'resolved' ? 'active' : ''}`}
          onClick={() => setStatusFilter('resolved')}
        >
          <span className="nav-icon">✓</span>
          Resolved
          <b>{totalCount - openCount}</b>
        </button>
        <button
          className={`nav-item ${statusFilter === 'all' ? 'active' : ''}`}
          onClick={() => setStatusFilter('all')}
        >
          <span className="nav-icon">◫</span>
          All incidents
          <b>{totalCount}</b>
        </button>
      </nav>

      <section className="on-call">
        <header>
          <p className="nav-label">On call now</p>
          <span>{activeResponders.length} online</span>
        </header>
        <div className="responder-stack">
          {responders.map((responder) => (
            <div className="responder" key={responder.id}>
              <span
                className="avatar"
                style={{ background: responder.avatarColor }}
              >
                {initials(responder.name)}
                <i className={responder.online ? 'online' : ''} />
              </span>
              <div>
                <strong>{responder.name}</strong>
                <small>{responder.role}</small>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="transport-card">
        <div className="transport-row">
          <span>React</span>
          <i />
          <span>gRPC-Web</span>
          <i />
          <span>Rust</span>
        </div>
        <p>Typed CRUD and live server-streaming events over one contract.</p>
      </div>
    </aside>
  );
}
