import {
  eventKind,
  timeAgo,
  type ConnectionState,
  type IncidentEvent,
} from '../model.js';

export function ActivityStrip({
  events,
  connection,
  revision,
  select,
}: {
  events: IncidentEvent[];
  connection: ConnectionState;
  revision: number;
  select(id: string): void;
}) {
  return (
    <section className="activity-strip">
      <header>
        <div>
          <i className={connection === 'live' ? 'pulse' : ''} />
          <strong>Live activity</strong>
        </div>
        <span>Server-streaming · revision {revision}</span>
      </header>
      <div className="event-list">
        {events.length === 0 ? (
          <p className="event-placeholder">
            Changes from any connected client will appear here in real time.
          </p>
        ) : (
          events.slice(0, 6).map((event) => (
            <button
              key={`${event.revision}-${event.incidentId}`}
              onClick={() => select(event.incidentId)}
            >
              <span className={`event-kind ${eventKind(event)}`}>
                {eventKind(event).replaceAll('_', ' ')}
              </span>
              <strong>
                {event.entry?.message ??
                  event.incident?.title ??
                  event.incidentId}
              </strong>
              <small>
                r{event.revision} · {timeAgo(event.emittedAt)}
              </small>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
