import type { DragEvent } from 'react';
import {
  SEVERITIES,
  SEVERITY_LABEL,
  STATUSES,
  STATUS_LABEL,
  incidentSeverity,
  incidentStatus,
  initials,
  timeAgo,
  type Incident,
  type NormalizedStatus,
  type ViewMode,
} from '../model.js';

export function IncidentExplorer({
  incidents,
  services,
  selectedId,
  query,
  statusFilter,
  severityFilter,
  serviceFilter,
  viewMode,
  select,
  setQuery,
  setStatusFilter,
  setSeverityFilter,
  setServiceFilter,
  setViewMode,
  move,
}: {
  incidents: Incident[];
  services: string[];
  selectedId: string;
  query: string;
  statusFilter: string;
  severityFilter: string;
  serviceFilter: string;
  viewMode: ViewMode;
  select(id: string): void;
  setQuery(value: string): void;
  setStatusFilter(value: string): void;
  setSeverityFilter(value: string): void;
  setServiceFilter(value: string): void;
  setViewMode(value: ViewMode): void;
  move(id: string, status: NormalizedStatus): void;
}) {
  return (
    <section className="incident-panel">
      <header className="section-heading">
        <div>
          <h2>Incidents</h2>
          <span>{incidents.length} matching records</span>
        </div>
        <div className="view-switch">
          <button
            className={viewMode === 'list' ? 'active' : ''}
            onClick={() => setViewMode('list')}
          >
            List
          </button>
          <button
            className={viewMode === 'board' ? 'active' : ''}
            onClick={() => {
              setViewMode('board');
              setStatusFilter('all');
            }}
          >
            Board
          </button>
        </div>
      </header>

      <div className="filters">
        <label className="search">
          <span>⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title, ID, service…"
          />
        </label>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="open">Open status</option>
          <option value="all">All statuses</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABEL[status]}
            </option>
          ))}
        </select>
        <select
          value={severityFilter}
          onChange={(event) => setSeverityFilter(event.target.value)}
        >
          <option value="all">All severity</option>
          {SEVERITIES.map((severity) => (
            <option key={severity} value={severity}>
              {SEVERITY_LABEL[severity]}
            </option>
          ))}
        </select>
        <select
          value={serviceFilter}
          onChange={(event) => setServiceFilter(event.target.value)}
        >
          <option value="all">All services</option>
          {services.map((service) => (
            <option key={service}>{service}</option>
          ))}
        </select>
      </div>

      {viewMode === 'list' ? (
        <IncidentList
          incidents={incidents}
          selectedId={selectedId}
          select={select}
        />
      ) : (
        <IncidentBoard
          incidents={incidents}
          selectedId={selectedId}
          select={select}
          move={move}
        />
      )}
    </section>
  );
}

function IncidentList({
  incidents,
  selectedId,
  select,
}: {
  incidents: Incident[];
  selectedId: string;
  select(id: string): void;
}) {
  return (
    <div className="incident-list">
      <div className="list-head">
        <span>Incident</span>
        <span>Status</span>
        <span>Commander</span>
        <span>Updated</span>
      </div>
      {incidents.map((incident) => {
        const status = incidentStatus(incident);
        const severity = incidentSeverity(incident);
        return (
          <button
            className={`incident-row ${selectedId === incident.id ? 'selected' : ''}`}
            key={incident.id}
            onClick={() => select(incident.id)}
          >
            <span className="incident-title">
              <i className={`severity-dot ${severity}`} />
              <span>
                <strong>{incident.title}</strong>
                <small>
                  {incident.id} · {incident.service}
                </small>
              </span>
            </span>
            <span>
              <em className={`status-pill ${status}`}>
                {STATUS_LABEL[status]}
              </em>
            </span>
            <span className="commander-cell">
              {incident.commander ? (
                <>
                  <i
                    className="mini-avatar"
                    style={{ background: incident.commander.avatarColor }}
                  >
                    {initials(incident.commander.name)}
                  </i>
                  {incident.commander.name}
                </>
              ) : (
                <small>Unassigned</small>
              )}
            </span>
            <span className="updated">{timeAgo(incident.updatedAt)}</span>
          </button>
        );
      })}
      {incidents.length === 0 && (
        <div className="empty">
          <span>⌕</span>
          <strong>No incidents match</strong>
          <p>Clear a filter or declare a new incident.</p>
        </div>
      )}
    </div>
  );
}

function IncidentBoard({
  incidents,
  selectedId,
  select,
  move,
}: {
  incidents: Incident[];
  selectedId: string;
  select(id: string): void;
  move(id: string, status: NormalizedStatus): void;
}) {
  const drop = (event: DragEvent<HTMLElement>, status: NormalizedStatus) => {
    event.preventDefault();
    const id = event.dataTransfer.getData('text/incident-id');
    if (id) move(id, status);
  };
  return (
    <div className="incident-board">
      {STATUSES.map((status) => {
        const items = incidents.filter(
          (incident) => incidentStatus(incident) === status,
        );
        return (
          <section
            className={`board-column ${status}`}
            key={status}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => drop(event, status)}
          >
            <header>
              <span>{STATUS_LABEL[status]}</span>
              <b>{items.length}</b>
            </header>
            <div>
              {items.map((incident) => {
                const severity = incidentSeverity(incident);
                return (
                  <article
                    className={`board-card ${selectedId === incident.id ? 'selected' : ''}`}
                    draggable
                    key={incident.id}
                    onDragStart={(event) =>
                      event.dataTransfer.setData(
                        'text/incident-id',
                        incident.id,
                      )
                    }
                  >
                    <button onClick={() => select(incident.id)}>
                      <span>
                        <i className={`severity-dot ${severity}`} />
                        {SEVERITY_LABEL[severity]}
                      </span>
                      <strong>{incident.title}</strong>
                      <small>
                        {incident.id} · {incident.service}
                      </small>
                      <footer>
                        {incident.commander ? (
                          <i
                            className="mini-avatar"
                            style={{
                              background: incident.commander.avatarColor,
                            }}
                          >
                            {initials(incident.commander.name)}
                          </i>
                        ) : (
                          <em>Unassigned</em>
                        )}
                        <span>{timeAgo(incident.updatedAt)}</span>
                      </footer>
                    </button>
                  </article>
                );
              })}
              {items.length === 0 && <p>Drop an incident here</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
