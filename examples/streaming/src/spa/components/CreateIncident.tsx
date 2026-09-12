import { useState, type FormEvent } from 'react';
import { client } from '../api.js';
import {
  SEVERITIES,
  SEVERITY_LABEL,
  type Incident,
  type Responder,
  type Severity,
} from '../model.js';

export function CreateIncident({
  responders,
  close,
  created,
  fail,
}: {
  responders: Responder[];
  close(): void;
  created(incident: Incident): void;
  fail(message: string): void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSubmitting(true);
    try {
      const incident = await client.incident.create.mutate({
        title: String(data.get('title') ?? ''),
        summary: String(data.get('summary') ?? ''),
        service: String(data.get('service') ?? ''),
        severity: String(data.get('severity')) as Severity,
        commanderId: String(data.get('commanderId') ?? '') || undefined,
        tags: String(data.get('tags') ?? '')
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        labels: { environment: 'production', source: 'pulseboard' },
      });
      created(incident);
    } catch (cause) {
      fail(cause instanceof Error ? cause.message : String(cause));
      setSubmitting(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <form className="modal" onSubmit={submit}>
        <header>
          <div>
            <p className="eyebrow">New response</p>
            <h2>Declare incident</h2>
          </div>
          <button type="button" onClick={close}>
            ×
          </button>
        </header>
        <label>
          Incident title
          <input
            name="title"
            minLength={3}
            maxLength={120}
            required
            autoFocus
            placeholder="What is happening?"
          />
        </label>
        <label>
          Impact summary
          <textarea
            name="summary"
            minLength={3}
            maxLength={2000}
            required
            rows={4}
            placeholder="Describe customer impact and current evidence."
          />
        </label>
        <div className="modal-grid">
          <label>
            Service
            <input name="service" required placeholder="checkout-api" />
          </label>
          <label>
            Severity
            <select name="severity" defaultValue="sev2">
              {SEVERITIES.map((severity) => (
                <option key={severity} value={severity}>
                  {SEVERITY_LABEL[severity]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Incident commander
          <select
            name="commanderId"
            defaultValue={
              responders.find((responder) => responder.online)?.id ?? ''
            }
          >
            <option value="">Unassigned</option>
            {responders.map((responder) => (
              <option value={responder.id} key={responder.id}>
                {responder.name}
                {responder.online ? ' · online' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tags
          <input name="tags" placeholder="customer-impact, payments, edge" />
          <small>Comma-separated operational labels</small>
        </label>
        <footer>
          <button type="button" className="secondary" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={submitting}>
            {submitting ? 'Declaring…' : 'Declare incident'}
          </button>
        </footer>
      </form>
    </div>
  );
}
