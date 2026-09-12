import { useEffect, useState, type FormEvent } from 'react';
import {
  SEVERITIES,
  SEVERITY_LABEL,
  STATUSES,
  STATUS_LABEL,
  incidentSeverity,
  incidentStatus,
  timeAgo,
  type Incident,
  type Responder,
  type RouterInputs,
  type Severity,
  type Status,
  type TimelineEntry,
} from '../model.js';

export function IncidentDetail({
  incident,
  responders,
  timeline,
  busy,
  note,
  setNote,
  update,
  toggleChecklist,
  addNote,
  remove,
}: {
  incident: Incident;
  responders: Responder[];
  timeline: TimelineEntry[];
  busy: string;
  note: string;
  setNote(value: string): void;
  update(input: RouterInputs['incident']['update']): Promise<boolean>;
  toggleChecklist(itemId: string, completed: boolean): Promise<void>;
  addNote(event: FormEvent): Promise<void>;
  remove(): Promise<void>;
}) {
  const status = incidentStatus(incident);
  const severity = incidentSeverity(incident);
  const checklist = incident.checklist ?? [];
  const tags = incident.tags ?? [];
  const labels = incident.labels ?? {};
  const [editing, setEditing] = useState(false);
  useEffect(() => setEditing(false), [incident.id]);

  return (
    <>
      <header className="detail-header">
        <div>
          <span className={`severity-badge ${severity}`}>
            {SEVERITY_LABEL[severity]}
          </span>
          <small>{incident.id}</small>
        </div>
        <div className="detail-actions">
          <button
            className="edit-button"
            onClick={() => setEditing((value) => !value)}
            disabled={Boolean(busy)}
          >
            {editing ? 'Cancel' : 'Edit'}
          </button>
          <button
            className="icon-button"
            title="Delete incident"
            onClick={remove}
            disabled={Boolean(busy)}
          >
            •••
          </button>
        </div>
      </header>
      <div className="detail-body">
        {editing ? (
          <EditIncidentForm
            incident={incident}
            busy={Boolean(busy)}
            cancel={() => setEditing(false)}
            save={async (input) => {
              if (await update(input)) setEditing(false);
            }}
          />
        ) : (
          <>
            <h2>{incident.title}</h2>
            <p className="summary">{incident.summary}</p>
          </>
        )}

        <div className="field-grid">
          <label>
            Status
            <select
              value={status}
              disabled={Boolean(busy)}
              onChange={(event) =>
                update({
                  id: incident.id,
                  status: event.target.value as Status,
                })
              }
            >
              {STATUSES.map((value) => (
                <option value={value} key={value}>
                  {STATUS_LABEL[value]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Severity
            <select
              value={severity}
              disabled={Boolean(busy)}
              onChange={(event) =>
                update({
                  id: incident.id,
                  severity: event.target.value as Severity,
                })
              }
            >
              {SEVERITIES.map((value) => (
                <option value={value} key={value}>
                  {SEVERITY_LABEL[value]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Commander
            <select
              value={incident.commander?.id ?? ''}
              disabled={Boolean(busy)}
              onChange={(event) => {
                const commanderId = event.target.value;
                void update(
                  commanderId
                    ? { id: incident.id, commanderId }
                    : { id: incident.id, clearCommander: true },
                );
              }}
            >
              <option value="">Unassigned</option>
              {responders.map((responder) => (
                <option value={responder.id} key={responder.id}>
                  {responder.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Service<span className="static-field">{incident.service}</span>
          </label>
        </div>

        <section className="detail-section">
          <header>
            <strong>Response checklist</strong>
            <span>
              {checklist.filter((item) => item.completed).length}/
              {checklist.length}
            </span>
          </header>
          <div className="checklist">
            {checklist.map((item) => (
              <button
                type="button"
                key={item.id}
                className={item.completed ? 'done' : ''}
                disabled={Boolean(busy)}
                onClick={() => void toggleChecklist(item.id, !item.completed)}
              >
                <i>{item.completed ? '✓' : ''}</i>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="detail-section">
          <header>
            <strong>Context</strong>
          </header>
          <div className="tags">
            {tags.map((tag) => (
              <span key={tag}>#{tag}</span>
            ))}
          </div>
          <dl>
            {Object.entries(labels).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="detail-section timeline">
          <header>
            <strong>Timeline</strong>
            <span>{timeline.length} events</span>
          </header>
          {timeline.map((entry) => (
            <article key={entry.id}>
              <i />
              <div>
                <strong>{entry.message}</strong>
                <p>
                  {entry.actor?.name ?? 'System'} · {timeAgo(entry.createdAt)}
                </p>
              </div>
              <small>r{entry.revision}</small>
            </article>
          ))}
          {timeline.length === 0 && (
            <p className="muted">No timeline entries yet.</p>
          )}
          <form className="note-form" onSubmit={addNote}>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add an operational note…"
              rows={2}
            />
            <button disabled={!note.trim() || Boolean(busy)}>
              {busy === 'note' ? 'Sending…' : 'Add note'}
            </button>
          </form>
        </section>
      </div>
    </>
  );
}

function EditIncidentForm({
  incident,
  busy,
  cancel,
  save,
}: {
  incident: Incident;
  busy: boolean;
  cancel(): void;
  save(input: RouterInputs['incident']['update']): Promise<void>;
}) {
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const labels = Object.fromEntries(
      String(data.get('labels') ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [key, ...parts] = line.split('=');
          return [key?.trim() ?? '', parts.join('=').trim()];
        })
        .filter(([key]) => key),
    );
    await save({
      id: incident.id,
      title: String(data.get('title') ?? ''),
      summary: String(data.get('summary') ?? ''),
      service: String(data.get('service') ?? ''),
      tags: String(data.get('tags') ?? '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      replaceTags: true,
      labels,
      replaceLabels: true,
    });
  };

  return (
    <form className="detail-edit" onSubmit={submit}>
      <label>
        Title
        <input
          name="title"
          defaultValue={incident.title}
          minLength={3}
          maxLength={120}
          required
        />
      </label>
      <label>
        Impact summary
        <textarea
          name="summary"
          defaultValue={incident.summary}
          minLength={3}
          maxLength={2000}
          rows={4}
          required
        />
      </label>
      <div>
        <label>
          Service
          <input name="service" defaultValue={incident.service} required />
        </label>
        <label>
          Tags
          <input name="tags" defaultValue={(incident.tags ?? []).join(', ')} />
        </label>
      </div>
      <label>
        Labels
        <textarea
          name="labels"
          defaultValue={Object.entries(incident.labels ?? {})
            .map(([key, value]) => `${key}=${value}`)
            .join('\n')}
          rows={3}
          placeholder={'region=us-east-1\nrunbook=checkout-latency'}
        />
      </label>
      <footer>
        <button type="button" className="secondary" onClick={cancel}>
          Cancel
        </button>
        <button className="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </footer>
    </form>
  );
}
