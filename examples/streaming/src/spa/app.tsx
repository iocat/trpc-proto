import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { createRoot } from 'react-dom/client';
import { client } from './api.js';
import { ActivityStrip } from './components/ActivityStrip.js';
import { CreateIncident } from './components/CreateIncident.js';
import { IncidentDetail } from './components/IncidentDetail.js';
import { IncidentExplorer } from './components/IncidentExplorer.js';
import { Metrics } from './components/Metrics.js';
import { Sidebar } from './components/Sidebar.js';
import {
  eventKind,
  incidentSeverity,
  incidentStatus,
  timeAgo,
  upsertIncident,
  type ConnectionState,
  type Incident,
  type IncidentEvent,
  type Responder,
  type RouterInputs,
  type Status,
  type TimelineEntry,
  type ViewMode,
} from './model.js';

function App() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [responders, setResponders] = useState<Responder[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [events, setEvents] = useState<IncidentEvent[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('open');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [serviceFilter, setServiceFilter] = useState('all');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [lastSignalAt, setLastSignalAt] = useState<Date>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState('');
  const [streamAttempt, setStreamAttempt] = useState(0);
  const revision = useRef(0);
  const selectedIdRef = useRef('');

  const selected = incidents.find((incident) => incident.id === selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const loadSnapshot = useCallback(async () => {
    const snapshot = await client.operations.snapshot.query({});
    const nextIncidents = snapshot.incidents ?? [];
    revision.current = Math.max(revision.current, snapshot.revision);
    setIncidents(nextIncidents);
    setResponders(snapshot.responders ?? []);
    setServices(snapshot.services ?? []);
    setSelectedId((current) =>
      nextIncidents.some((incident) => incident.id === current)
        ? current
        : nextIncidents[0]?.id || '',
    );
  }, []);

  useEffect(() => {
    loadSnapshot().catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
      setConnection('error');
    });
  }, [loadSnapshot]);

  useEffect(() => {
    setConnection('connecting');
    const subscription = client.incident.watch.subscribe(
      { afterRevision: revision.current, heartbeatSeconds: 4 },
      {
        onStarted() {
          setConnection('live');
          setError('');
        },
        onData(event) {
          revision.current = Math.max(revision.current, event.revision);
          setConnection('live');
          setLastSignalAt(new Date());
          const kind = eventKind(event);
          if (kind === 'heartbeat') return;
          setEvents((current) => [event, ...current].slice(0, 24));
          if (kind === 'incident_deleted') {
            setIncidents((current) =>
              current.filter((incident) => incident.id !== event.incidentId),
            );
            setSelectedId((current) =>
              current === event.incidentId ? '' : current,
            );
            return;
          }
          if (event.incident) {
            setIncidents((current) => upsertIncident(current, event.incident!));
          }
          if (event.entry && event.incidentId === selectedIdRef.current) {
            setTimeline((current) =>
              current.some((entry) => entry.id === event.entry?.id)
                ? current
                : [...current, event.entry!],
            );
          }
        },
        onError(cause) {
          setConnection('error');
          setError(cause.message);
        },
      },
    );
    return () => subscription.unsubscribe();
  }, [streamAttempt]);

  useEffect(() => {
    if (!selectedId) {
      setTimeline([]);
      return;
    }
    client.incident.timeline
      .query({ incidentId: selectedId })
      .then((result) => setTimeline(result.items ?? []))
      .catch((cause) => setError(cause.message));
  }, [selectedId]);

  const refresh = async () => {
    setRefreshing(true);
    setError('');
    try {
      await loadSnapshot();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRefreshing(false);
    }
  };

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return incidents.filter((incident) => {
      const status = incidentStatus(incident);
      const severity = incidentSeverity(incident);
      if (statusFilter === 'open' && status === 'resolved') return false;
      if (
        statusFilter !== 'all' &&
        statusFilter !== 'open' &&
        status !== statusFilter
      ) {
        return false;
      }
      if (severityFilter !== 'all' && severity !== severityFilter) return false;
      if (serviceFilter !== 'all' && incident.service !== serviceFilter) {
        return false;
      }
      if (!normalizedQuery) return true;
      return [incident.id, incident.title, incident.summary, incident.service]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [incidents, query, serviceFilter, severityFilter, statusFilter]);

  const openIncidents = incidents.filter(
    (incident) => incidentStatus(incident) !== 'resolved',
  );
  const activeResponders = responders.filter((responder) => responder.online);
  const criticalCount = openIncidents.filter(
    (incident) => incidentSeverity(incident) === 'sev1',
  ).length;

  const updateIncident = async (
    input: RouterInputs['incident']['update'],
  ): Promise<boolean> => {
    setBusy('update');
    setError('');
    try {
      const updated = await client.incident.update.mutate(input);
      setIncidents((current) => upsertIncident(current, updated));
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy('');
    }
  };

  const toggleChecklist = async (itemId: string, completed: boolean) => {
    if (!selected) return;
    setBusy(`checklist:${itemId}`);
    setError('');
    try {
      const updated = await client.incident.toggleChecklist.mutate({
        incidentId: selected.id,
        itemId,
        completed,
      });
      setIncidents((current) => upsertIncident(current, updated));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy('');
    }
  };

  const deleteIncident = async () => {
    if (!selected || !window.confirm(`Delete ${selected.id}?`)) return;
    setBusy('delete');
    try {
      await client.incident.delete.mutate({ id: selected.id });
      setIncidents((current) =>
        current.filter((incident) => incident.id !== selected.id),
      );
      setSelectedId('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy('');
    }
  };

  const addNote = async (formEvent: FormEvent) => {
    formEvent.preventDefault();
    const author = activeResponders[0] ?? responders[0];
    if (!selected || !author || !note.trim()) return;
    setBusy('note');
    try {
      const entry = await client.incident.addNote.mutate({
        incidentId: selected.id,
        authorId: author.id,
        message: note.trim(),
      });
      setTimeline((current) =>
        current.some((item) => item.id === entry.id)
          ? current
          : [...current, entry],
      );
      setNote('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="shell">
      <Sidebar
        responders={responders}
        openCount={openIncidents.length}
        totalCount={incidents.length}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
      />

      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">Production workspace</p>
            <h1>Incident command</h1>
          </div>
          <div className="top-actions">
            <button
              className="refresh-button"
              onClick={refresh}
              disabled={refreshing}
            >
              <span>↻</span> {refreshing ? 'Refreshing' : 'Refresh'}
            </button>
            <button
              className={`connection ${connection}`}
              onClick={() => setStreamAttempt((attempt) => attempt + 1)}
            >
              <i />
              {connection === 'live'
                ? `Live${lastSignalAt ? ` · ${timeAgo(lastSignalAt)}` : ''}`
                : connection === 'connecting'
                  ? 'Connecting'
                  : 'Reconnect stream'}
            </button>
            <button className="primary" onClick={() => setShowCreate(true)}>
              <span>＋</span> Declare incident
            </button>
          </div>
        </header>

        {error && (
          <div className="error-banner">
            <strong>Request failed</strong>
            <span>{error}</span>
            <button onClick={() => setError('')}>×</button>
          </div>
        )}

        <Metrics
          criticalCount={criticalCount}
          openCount={openIncidents.length}
          totalCount={incidents.length}
          onlineCount={activeResponders.length}
          responderCount={responders.length}
          revision={revision.current}
        />

        <div className="workspace">
          <IncidentExplorer
            incidents={filtered}
            services={services}
            selectedId={selectedId}
            query={query}
            statusFilter={statusFilter}
            severityFilter={severityFilter}
            serviceFilter={serviceFilter}
            viewMode={viewMode}
            select={setSelectedId}
            setQuery={setQuery}
            setStatusFilter={setStatusFilter}
            setSeverityFilter={setSeverityFilter}
            setServiceFilter={setServiceFilter}
            setViewMode={setViewMode}
            move={(id, status) =>
              void updateIncident({ id, status: status as Status })
            }
          />

          <aside className="detail-panel">
            {selected ? (
              <IncidentDetail
                incident={selected}
                responders={responders}
                timeline={timeline}
                busy={busy}
                note={note}
                setNote={setNote}
                update={updateIncident}
                toggleChecklist={toggleChecklist}
                addNote={addNote}
                remove={deleteIncident}
              />
            ) : (
              <div className="detail-empty">
                <span>↖</span>
                <h3>Select an incident</h3>
                <p>Inspect state, update ownership, and add timeline notes.</p>
              </div>
            )}
          </aside>
        </div>

        <ActivityStrip
          events={events}
          connection={connection}
          revision={revision.current}
          select={setSelectedId}
        />
      </main>

      {showCreate && (
        <CreateIncident
          responders={responders}
          close={() => setShowCreate(false)}
          created={(incident) => {
            setIncidents((current) => upsertIncident(current, incident));
            setSelectedId(incident.id);
            setShowCreate(false);
          }}
          fail={setError}
        />
      )}
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');
createRoot(root).render(<App />);
