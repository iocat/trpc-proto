import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../router.js';

export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type Incident = RouterOutputs['incident']['get'];
export type Responder =
  RouterOutputs['operations']['responders']['items'][number];
export type TimelineEntry =
  RouterOutputs['incident']['timeline']['items'][number];
type WatchOutput = RouterOutputs['incident']['watch'];
export type IncidentEvent =
  WatchOutput extends AsyncIterable<infer Event> ? Event : never;
export type Status = Incident['status'];
export type Severity = Incident['severity'];
export type ConnectionState = 'connecting' | 'live' | 'error';
export type ViewMode = 'list' | 'board';

export const STATUSES = [
  'investigating',
  'identified',
  'monitoring',
  'resolved',
] as const;
export const SEVERITIES = ['sev1', 'sev2', 'sev3', 'sev4'] as const;
export type NormalizedStatus = (typeof STATUSES)[number];
export type NormalizedSeverity = (typeof SEVERITIES)[number];

export const STATUS_LABEL: Record<NormalizedStatus, string> = {
  investigating: 'Investigating',
  identified: 'Identified',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
};
export const SEVERITY_LABEL: Record<NormalizedSeverity, string> = {
  sev1: 'SEV 1',
  sev2: 'SEV 2',
  sev3: 'SEV 3',
  sev4: 'SEV 4',
};

function enumValue<T extends string>(value: unknown, prefix: string): T {
  const raw = String(value ?? '').toLowerCase();
  return raw.startsWith(prefix.toLowerCase())
    ? (raw.slice(prefix.length) as T)
    : (raw as T);
}

export function incidentStatus(incident: Incident): NormalizedStatus {
  const value = enumValue<NormalizedStatus>(
    incident.status,
    'incident_status_',
  );
  return STATUSES.includes(value) ? value : 'investigating';
}

export function incidentSeverity(incident: Incident): NormalizedSeverity {
  const value = enumValue<NormalizedSeverity>(
    incident.severity,
    'incident_severity_',
  );
  return SEVERITIES.includes(value) ? value : 'sev4';
}

export function eventKind(event: IncidentEvent): string {
  return enumValue<string>(event.kind, 'activity_kind_');
}

function dateValue(value: Date | string | number | undefined): Date {
  return value instanceof Date ? value : new Date(value ?? 0);
}

export function timeAgo(value: Date | string | number | undefined): string {
  const seconds = Math.max(
    0,
    Math.round((Date.now() - dateValue(value).getTime()) / 1_000),
  );
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export function initials(name: string | undefined): string {
  return String(name ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export function upsertIncident(items: Incident[], next: Incident): Incident[] {
  const remaining = items.filter((item) => item.id !== next.id);
  return [next, ...remaining].sort(
    (left, right) => (right.revision ?? 0) - (left.revision ?? 0),
  );
}
