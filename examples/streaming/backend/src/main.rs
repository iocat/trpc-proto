use std::{
    collections::{BTreeSet, HashMap, VecDeque},
    net::SocketAddr,
    pin::Pin,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use tokio::sync::{broadcast, mpsc, RwLock};
use tokio_stream::{wrappers::ReceiverStream, Stream};
use tonic::{codec::CompressionEncoding, transport::Server, Request, Response, Status};

pub mod operations_v1 {
    tonic::include_proto!("operations.v1");
}

use operations_v1::{
    incident_service_server::{IncidentService, IncidentServiceServer},
    operations_service_server::{OperationsService, OperationsServiceServer},
    ActivityKind, ChecklistItem, Incident, IncidentAddNoteRequest, IncidentCreateRequest,
    IncidentDeleteRequest, IncidentDeleteResponse, IncidentEvent, IncidentGetRequest,
    IncidentListRequest, IncidentListResponse, IncidentSeverity, IncidentStatus,
    IncidentTimelineRequest, IncidentTimelineResponse, IncidentToggleChecklistRequest,
    IncidentUpdateRequest, IncidentWatchRequest, OperationsRespondersRequest,
    OperationsRespondersResponse, OperationsSnapshot, OperationsSnapshotRequest, Responder,
    TimelineEntry,
};

const ADDRESS: &str = "127.0.0.1:50054";
const EVENT_HISTORY_LIMIT: usize = 256;

#[derive(Clone)]
struct OperationsBackend {
    store: Arc<RwLock<Store>>,
    events: broadcast::Sender<IncidentEvent>,
}

struct Store {
    incidents: HashMap<String, Incident>,
    timelines: HashMap<String, Vec<TimelineEntry>>,
    responders: Vec<Responder>,
    event_history: VecDeque<IncidentEvent>,
    revision: i32,
    next_incident: u32,
    next_entry: u32,
}

fn timestamp() -> prost_types::Timestamp {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    prost_types::Timestamp {
        seconds: i64::try_from(elapsed.as_secs()).unwrap_or(i64::MAX),
        nanos: i32::try_from(elapsed.subsec_nanos()).unwrap_or_default(),
    }
}

fn responder(id: &str, name: &str, role: &str, color: &str, online: bool) -> Responder {
    Responder {
        id: Some(id.to_owned()),
        name: Some(name.to_owned()),
        role: Some(role.to_owned()),
        avatar_color: Some(color.to_owned()),
        online: Some(online),
    }
}

fn checklist(items: &[(&str, bool)]) -> Vec<ChecklistItem> {
    items
        .iter()
        .enumerate()
        .map(|(index, (label, completed))| ChecklistItem {
            id: Some(format!("step-{}", index + 1)),
            label: Some((*label).to_owned()),
            completed: Some(*completed),
        })
        .collect()
}

fn incident(
    id: &str,
    title: &str,
    summary: &str,
    service: &str,
    status: IncidentStatus,
    severity: IncidentSeverity,
    commander: Option<Responder>,
    tags: &[&str],
    labels: &[(&str, &str)],
    steps: &[(&str, bool)],
    revision: i32,
) -> Incident {
    let created_at = timestamp();
    Incident {
        id: Some(id.to_owned()),
        title: Some(title.to_owned()),
        summary: Some(summary.to_owned()),
        service: Some(service.to_owned()),
        status: Some(status as i32),
        severity: Some(severity as i32),
        commander,
        tags: tags.iter().map(|tag| (*tag).to_owned()).collect(),
        labels: labels
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect(),
        checklist: checklist(steps),
        created_at: Some(created_at.clone()),
        updated_at: Some(created_at),
        revision: Some(revision),
    }
}

impl Store {
    fn seeded() -> Self {
        let responders = vec![
            responder("rsp-1", "Maya Chen", "Incident commander", "#f97360", true),
            responder("rsp-2", "Eli Torres", "Platform engineer", "#7c9cff", true),
            responder(
                "rsp-3",
                "Nora Patel",
                "Database specialist",
                "#57c7a5",
                true,
            ),
            responder(
                "rsp-4",
                "Owen Brooks",
                "Customer operations",
                "#d6a85f",
                false,
            ),
        ];
        let seeded = vec![
            incident(
                "INC-1042",
                "Checkout latency above SLO",
                "P95 checkout latency crossed 1.8s after the latest edge rollout.",
                "checkout-api",
                IncidentStatus::Investigating,
                IncidentSeverity::Sev1,
                Some(responders[0].clone()),
                &["customer-impact", "edge"],
                &[("region", "us-east-1"), ("runbook", "checkout-latency")],
                &[
                    ("Confirm impact window", true),
                    ("Compare edge cohorts", true),
                    ("Roll back affected cohort", false),
                ],
                12,
            ),
            incident(
                "INC-1041",
                "Delayed webhook deliveries",
                "The delivery queue is recovering after a broker partition reassignment.",
                "webhook-worker",
                IncidentStatus::Monitoring,
                IncidentSeverity::Sev2,
                Some(responders[1].clone()),
                &["queue", "integrations"],
                &[("region", "global"), ("ticket", "OPS-882")],
                &[
                    ("Drain retry queue", true),
                    ("Verify partner delivery rate", false),
                ],
                11,
            ),
            incident(
                "INC-1040",
                "Read replica connection churn",
                "Connection resets are isolated to one replica pool and failover is stable.",
                "accounts-db",
                IncidentStatus::Identified,
                IncidentSeverity::Sev2,
                Some(responders[2].clone()),
                &["database", "connections"],
                &[("region", "eu-west-1")],
                &[
                    ("Pin traffic to healthy pool", true),
                    ("Replace degraded replica", false),
                ],
                10,
            ),
            incident(
                "INC-1039",
                "Stale usage totals",
                "Hourly usage aggregation completed after a delayed warehouse load.",
                "usage-pipeline",
                IncidentStatus::Resolved,
                IncidentSeverity::Sev3,
                None,
                &["analytics"],
                &[("region", "global")],
                &[("Backfill missing window", true), ("Validate totals", true)],
                9,
            ),
        ];
        let incidents = seeded
            .into_iter()
            .map(|incident| (incident.id.clone().unwrap_or_default(), incident))
            .collect();

        Self {
            incidents,
            timelines: HashMap::from([
                (
                    "INC-1042".to_owned(),
                    vec![TimelineEntry {
                        id: Some("evt-21".to_owned()),
                        incident_id: Some("INC-1042".to_owned()),
                        kind: Some(ActivityKind::IncidentCreated as i32),
                        actor: Some(responders[0].clone()),
                        message: Some("Incident declared from checkout SLO alert".to_owned()),
                        created_at: Some(timestamp()),
                        revision: Some(12),
                    }],
                ),
                (
                    "INC-1041".to_owned(),
                    vec![TimelineEntry {
                        id: Some("evt-20".to_owned()),
                        incident_id: Some("INC-1041".to_owned()),
                        kind: Some(ActivityKind::IncidentUpdated as i32),
                        actor: Some(responders[1].clone()),
                        message: Some("Queue depth returned below alert threshold".to_owned()),
                        created_at: Some(timestamp()),
                        revision: Some(11),
                    }],
                ),
            ]),
            responders,
            event_history: VecDeque::new(),
            revision: 12,
            next_incident: 1043,
            next_entry: 22,
        }
    }

    fn next_revision(&mut self) -> i32 {
        self.revision += 1;
        self.revision
    }

    fn next_entry_id(&mut self) -> String {
        let id = format!("evt-{}", self.next_entry);
        self.next_entry += 1;
        id
    }

    fn record_event(&mut self, event: IncidentEvent) {
        self.event_history.push_back(event);
        while self.event_history.len() > EVENT_HISTORY_LIMIT {
            self.event_history.pop_front();
        }
    }

    fn responder_by_id(&self, id: &str) -> Option<Responder> {
        self.responders
            .iter()
            .find(|responder| responder.id.as_deref() == Some(id))
            .cloned()
    }
}

impl OperationsBackend {
    fn seeded() -> Self {
        let (events, _) = broadcast::channel(128);
        Self {
            store: Arc::new(RwLock::new(Store::seeded())),
            events,
        }
    }

    fn publish(&self, event: IncidentEvent) {
        let _ = self.events.send(event);
    }
}

fn required(value: Option<String>, name: &str) -> Result<String, Status> {
    let value = value.unwrap_or_default();
    let value = value.trim();
    if value.is_empty() {
        return Err(Status::invalid_argument(format!("{name} is required")));
    }
    Ok(value.to_owned())
}

fn validate_length(value: &str, name: &str, min: usize, max: usize) -> Result<(), Status> {
    if !(min..=max).contains(&value.chars().count()) {
        return Err(Status::invalid_argument(format!(
            "{name} must contain between {min} and {max} characters"
        )));
    }
    Ok(())
}

fn event(
    revision: i32,
    kind: ActivityKind,
    incident_id: String,
    incident: Option<Incident>,
    entry: Option<TimelineEntry>,
) -> IncidentEvent {
    IncidentEvent {
        revision: Some(revision),
        kind: Some(kind as i32),
        incident,
        entry,
        incident_id: Some(incident_id),
        emitted_at: Some(timestamp()),
    }
}

fn sort_incidents(incidents: &mut [Incident]) {
    incidents.sort_by(|left, right| {
        right
            .revision
            .unwrap_or_default()
            .cmp(&left.revision.unwrap_or_default())
    });
}

#[tonic::async_trait]
impl OperationsService for OperationsBackend {
    async fn snapshot(
        &self,
        _request: Request<OperationsSnapshotRequest>,
    ) -> Result<Response<OperationsSnapshot>, Status> {
        let store = self.store.read().await;
        let mut incidents: Vec<_> = store.incidents.values().cloned().collect();
        sort_incidents(&mut incidents);
        let services = incidents
            .iter()
            .filter_map(|incident| incident.service.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        let mut open_by_severity = HashMap::new();
        for incident in incidents
            .iter()
            .filter(|incident| incident.status != Some(IncidentStatus::Resolved as i32))
        {
            let severity = IncidentSeverity::try_from(incident.severity.unwrap_or_default())
                .unwrap_or(IncidentSeverity::Sev4)
                .as_str_name()
                .trim_start_matches("INCIDENT_SEVERITY_")
                .to_ascii_lowercase();
            *open_by_severity.entry(severity).or_insert(0) += 1;
        }
        Ok(Response::new(OperationsSnapshot {
            incidents,
            responders: store.responders.clone(),
            open_by_severity,
            services,
            revision: Some(store.revision),
        }))
    }

    async fn responders(
        &self,
        request: Request<OperationsRespondersRequest>,
    ) -> Result<Response<OperationsRespondersResponse>, Status> {
        let online_only = request.into_inner().online_only.unwrap_or(false);
        let store = self.store.read().await;
        let items = store
            .responders
            .iter()
            .filter(|responder| !online_only || responder.online.unwrap_or(false))
            .cloned()
            .collect();
        Ok(Response::new(OperationsRespondersResponse { items }))
    }
}

#[tonic::async_trait]
impl IncidentService for OperationsBackend {
    async fn list(
        &self,
        request: Request<IncidentListRequest>,
    ) -> Result<Response<IncidentListResponse>, Status> {
        let request = request.into_inner();
        let query = request.query.unwrap_or_default().to_ascii_lowercase();
        let page_size = request.page_size.unwrap_or(50).clamp(1, 100) as usize;
        let store = self.store.read().await;
        let mut items: Vec<_> = store
            .incidents
            .values()
            .filter(|incident| request.status.is_none() || incident.status == request.status)
            .filter(|incident| request.severity.is_none() || incident.severity == request.severity)
            .filter(|incident| {
                request
                    .service
                    .as_ref()
                    .is_none_or(|service| incident.service.as_deref() == Some(service.as_str()))
            })
            .filter(|incident| {
                query.is_empty()
                    || [
                        incident.id.as_deref(),
                        incident.title.as_deref(),
                        incident.summary.as_deref(),
                        incident.service.as_deref(),
                    ]
                    .into_iter()
                    .flatten()
                    .any(|value| value.to_ascii_lowercase().contains(&query))
            })
            .cloned()
            .collect();
        sort_incidents(&mut items);
        let total = i32::try_from(items.len()).unwrap_or(i32::MAX);
        items.truncate(page_size);
        Ok(Response::new(IncidentListResponse {
            items,
            total: Some(total),
            revision: Some(store.revision),
        }))
    }

    async fn get(
        &self,
        request: Request<IncidentGetRequest>,
    ) -> Result<Response<Incident>, Status> {
        let id = required(request.into_inner().id, "id")?;
        let store = self.store.read().await;
        let incident = store
            .incidents
            .get(&id)
            .cloned()
            .ok_or_else(|| Status::not_found(format!("incident {id} not found")))?;
        Ok(Response::new(incident))
    }

    async fn create(
        &self,
        request: Request<IncidentCreateRequest>,
    ) -> Result<Response<Incident>, Status> {
        let request = request.into_inner();
        let title = required(request.title, "title")?;
        let summary = required(request.summary, "summary")?;
        let service = required(request.service, "service")?;
        validate_length(&title, "title", 3, 120)?;
        validate_length(&summary, "summary", 3, 2_000)?;
        let severity = request
            .severity
            .and_then(|value| IncidentSeverity::try_from(value).ok())
            .ok_or_else(|| Status::invalid_argument("severity is required"))?;

        let mut store = self.store.write().await;
        let commander = request
            .commander_id
            .as_deref()
            .map(|id| {
                store
                    .responder_by_id(id)
                    .ok_or_else(|| Status::invalid_argument(format!("responder {id} not found")))
            })
            .transpose()?;
        let id = format!("INC-{}", store.next_incident);
        store.next_incident += 1;
        let revision = store.next_revision();
        let incident = Incident {
            id: Some(id.clone()),
            title: Some(title.clone()),
            summary: Some(summary),
            service: Some(service),
            status: Some(IncidentStatus::Investigating as i32),
            severity: Some(severity as i32),
            commander: commander.clone(),
            tags: request.tags,
            labels: request.labels,
            checklist: checklist(&[
                ("Confirm customer impact", false),
                ("Assign incident commander", commander.is_some()),
                ("Publish initial update", false),
            ]),
            created_at: Some(timestamp()),
            updated_at: Some(timestamp()),
            revision: Some(revision),
        };
        let entry = TimelineEntry {
            id: Some(store.next_entry_id()),
            incident_id: Some(id.clone()),
            kind: Some(ActivityKind::IncidentCreated as i32),
            actor: commander,
            message: Some(format!("Incident declared: {title}")),
            created_at: Some(timestamp()),
            revision: Some(revision),
        };
        store.incidents.insert(id.clone(), incident.clone());
        store
            .timelines
            .entry(id.clone())
            .or_default()
            .push(entry.clone());
        let event = event(
            revision,
            ActivityKind::IncidentCreated,
            id,
            Some(incident.clone()),
            Some(entry),
        );
        store.record_event(event.clone());
        drop(store);
        self.publish(event);
        Ok(Response::new(incident))
    }

    async fn update(
        &self,
        request: Request<IncidentUpdateRequest>,
    ) -> Result<Response<Incident>, Status> {
        let request = request.into_inner();
        let id = required(request.id, "id")?;
        if let Some(title) = request.title.as_deref() {
            validate_length(title, "title", 3, 120)?;
        }
        if let Some(summary) = request.summary.as_deref() {
            validate_length(summary, "summary", 3, 2_000)?;
        }

        let mut store = self.store.write().await;
        if !store.incidents.contains_key(&id) {
            return Err(Status::not_found(format!("incident {id} not found")));
        }
        let commander = request
            .commander_id
            .as_deref()
            .map(|responder_id| {
                store.responder_by_id(responder_id).ok_or_else(|| {
                    Status::invalid_argument(format!("responder {responder_id} not found"))
                })
            })
            .transpose()?;
        let revision = store.next_revision();
        {
            let incident = store.incidents.get_mut(&id).expect("incident exists");
            if let Some(title) = request.title {
                incident.title = Some(title);
            }
            if let Some(summary) = request.summary {
                incident.summary = Some(summary);
            }
            if let Some(service) = request.service {
                incident.service = Some(service);
            }
            if let Some(status) = request.status {
                IncidentStatus::try_from(status)
                    .map_err(|_| Status::invalid_argument("invalid status"))?;
                incident.status = Some(status);
            }
            if let Some(severity) = request.severity {
                IncidentSeverity::try_from(severity)
                    .map_err(|_| Status::invalid_argument("invalid severity"))?;
                incident.severity = Some(severity);
            }
            if request.clear_commander.unwrap_or(false) {
                incident.commander = None;
            } else if commander.is_some() {
                incident.commander = commander.clone();
            }
            if request.replace_tags.unwrap_or(!request.tags.is_empty()) {
                incident.tags = request.tags;
            }
            if request.replace_labels.unwrap_or(!request.labels.is_empty()) {
                incident.labels = request.labels;
            }
            incident.updated_at = Some(timestamp());
            incident.revision = Some(revision);
        }
        let incident = store.incidents.get(&id).cloned().expect("incident exists");
        let actor = commander.or_else(|| incident.commander.clone());
        let entry = TimelineEntry {
            id: Some(store.next_entry_id()),
            incident_id: Some(id.clone()),
            kind: Some(ActivityKind::IncidentUpdated as i32),
            actor,
            message: Some("Incident fields updated".to_owned()),
            created_at: Some(timestamp()),
            revision: Some(revision),
        };
        store
            .timelines
            .entry(id.clone())
            .or_default()
            .push(entry.clone());
        let event = event(
            revision,
            ActivityKind::IncidentUpdated,
            id,
            Some(incident.clone()),
            Some(entry),
        );
        store.record_event(event.clone());
        drop(store);
        self.publish(event);
        Ok(Response::new(incident))
    }

    async fn toggle_checklist(
        &self,
        request: Request<IncidentToggleChecklistRequest>,
    ) -> Result<Response<Incident>, Status> {
        let request = request.into_inner();
        let incident_id = required(request.incident_id, "incidentId")?;
        let item_id = required(request.item_id, "itemId")?;
        let completed = request
            .completed
            .ok_or_else(|| Status::invalid_argument("completed is required"))?;
        let mut store = self.store.write().await;
        let item_exists = store
            .incidents
            .get(&incident_id)
            .ok_or_else(|| Status::not_found(format!("incident {incident_id} not found")))?
            .checklist
            .iter()
            .any(|item| item.id.as_deref() == Some(item_id.as_str()));
        if !item_exists {
            return Err(Status::not_found(format!(
                "checklist item {item_id} not found"
            )));
        }
        let revision = store.next_revision();
        let incident = store
            .incidents
            .get_mut(&incident_id)
            .expect("incident exists");
        let item = incident
            .checklist
            .iter_mut()
            .find(|item| item.id.as_deref() == Some(item_id.as_str()))
            .expect("checklist item exists");
        item.completed = Some(completed);
        let item_label = item.label.clone().unwrap_or_else(|| item_id.clone());
        incident.updated_at = Some(timestamp());
        incident.revision = Some(revision);
        let incident = incident.clone();
        let entry = TimelineEntry {
            id: Some(store.next_entry_id()),
            incident_id: Some(incident_id.clone()),
            kind: Some(ActivityKind::IncidentUpdated as i32),
            actor: incident.commander.clone(),
            message: Some(format!(
                "{} checklist item: {item_label}",
                if completed { "Completed" } else { "Reopened" }
            )),
            created_at: Some(timestamp()),
            revision: Some(revision),
        };
        store
            .timelines
            .entry(incident_id.clone())
            .or_default()
            .push(entry.clone());
        let event = event(
            revision,
            ActivityKind::IncidentUpdated,
            incident_id,
            Some(incident.clone()),
            Some(entry),
        );
        store.record_event(event.clone());
        drop(store);
        self.publish(event);
        Ok(Response::new(incident))
    }

    async fn delete(
        &self,
        request: Request<IncidentDeleteRequest>,
    ) -> Result<Response<IncidentDeleteResponse>, Status> {
        let id = required(request.into_inner().id, "id")?;
        let mut store = self.store.write().await;
        let deleted = store
            .incidents
            .remove(&id)
            .ok_or_else(|| Status::not_found(format!("incident {id} not found")))?;
        let revision = store.next_revision();
        let entry = TimelineEntry {
            id: Some(store.next_entry_id()),
            incident_id: Some(id.clone()),
            kind: Some(ActivityKind::IncidentDeleted as i32),
            actor: deleted.commander,
            message: Some("Incident deleted".to_owned()),
            created_at: Some(timestamp()),
            revision: Some(revision),
        };
        store
            .timelines
            .entry(id.clone())
            .or_default()
            .push(entry.clone());
        let event = event(
            revision,
            ActivityKind::IncidentDeleted,
            id.clone(),
            None,
            Some(entry),
        );
        store.record_event(event.clone());
        drop(store);
        self.publish(event);
        Ok(Response::new(IncidentDeleteResponse {
            id: Some(id),
            deleted: Some(true),
            revision: Some(revision),
        }))
    }

    async fn add_note(
        &self,
        request: Request<IncidentAddNoteRequest>,
    ) -> Result<Response<TimelineEntry>, Status> {
        let request = request.into_inner();
        let incident_id = required(request.incident_id, "incidentId")?;
        let author_id = required(request.author_id, "authorId")?;
        let message = required(request.message, "message")?;
        validate_length(&message, "message", 1, 2_000)?;

        let mut store = self.store.write().await;
        if !store.incidents.contains_key(&incident_id) {
            return Err(Status::not_found(format!(
                "incident {incident_id} not found"
            )));
        }
        let actor = store
            .responder_by_id(&author_id)
            .ok_or_else(|| Status::invalid_argument(format!("responder {author_id} not found")))?;
        let revision = store.next_revision();
        if let Some(incident) = store.incidents.get_mut(&incident_id) {
            incident.updated_at = Some(timestamp());
            incident.revision = Some(revision);
        }
        let incident = store.incidents.get(&incident_id).cloned();
        let entry = TimelineEntry {
            id: Some(store.next_entry_id()),
            incident_id: Some(incident_id.clone()),
            kind: Some(ActivityKind::NoteAdded as i32),
            actor: Some(actor),
            message: Some(message),
            created_at: Some(timestamp()),
            revision: Some(revision),
        };
        store
            .timelines
            .entry(incident_id.clone())
            .or_default()
            .push(entry.clone());
        let event = event(
            revision,
            ActivityKind::NoteAdded,
            incident_id,
            incident,
            Some(entry.clone()),
        );
        store.record_event(event.clone());
        drop(store);
        self.publish(event);
        Ok(Response::new(entry))
    }

    async fn timeline(
        &self,
        request: Request<IncidentTimelineRequest>,
    ) -> Result<Response<IncidentTimelineResponse>, Status> {
        let incident_id = required(request.into_inner().incident_id, "incidentId")?;
        let store = self.store.read().await;
        if !store.incidents.contains_key(&incident_id)
            && !store.timelines.contains_key(&incident_id)
        {
            return Err(Status::not_found(format!(
                "incident {incident_id} not found"
            )));
        }
        let items = store
            .timelines
            .get(&incident_id)
            .cloned()
            .unwrap_or_default();
        Ok(Response::new(IncidentTimelineResponse { items }))
    }

    type WatchStream = Pin<Box<dyn Stream<Item = Result<IncidentEvent, Status>> + Send>>;

    async fn watch(
        &self,
        request: Request<IncidentWatchRequest>,
    ) -> Result<Response<Self::WatchStream>, Status> {
        let request = request.into_inner();
        let mut cursor = request.after_revision.unwrap_or_default();
        let heartbeat_seconds = request.heartbeat_seconds.unwrap_or(10).clamp(1, 30) as u64;
        let mut broadcast = self.events.subscribe();
        let store = self.store.clone();
        let backlog: Vec<_> = {
            let store = store.read().await;
            store
                .event_history
                .iter()
                .filter(|event| event.revision.unwrap_or_default() > cursor)
                .cloned()
                .collect()
        };
        let (sender, receiver) = mpsc::channel(64);

        tokio::spawn(async move {
            for event in backlog {
                cursor = cursor.max(event.revision.unwrap_or_default());
                if sender.send(Ok(event)).await.is_err() {
                    return;
                }
            }
            let mut heartbeat = tokio::time::interval(Duration::from_secs(heartbeat_seconds));
            heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            heartbeat.tick().await;

            loop {
                tokio::select! {
                    received = broadcast.recv() => match received {
                        Ok(event) => {
                            let revision = event.revision.unwrap_or_default();
                            if revision > cursor {
                                cursor = revision;
                                if sender.send(Ok(event)).await.is_err() {
                                    return;
                                }
                            }
                        }
                        Err(broadcast::error::RecvError::Lagged(skipped)) => {
                            let _ = sender
                                .send(Err(Status::data_loss(format!(
                                    "subscriber lagged by {skipped} events"
                                ))))
                                .await;
                            return;
                        }
                        Err(broadcast::error::RecvError::Closed) => return,
                    },
                    _ = heartbeat.tick() => {
                        let revision = store.read().await.revision;
                        let heartbeat_event = event(
                            revision,
                            ActivityKind::Heartbeat,
                            String::new(),
                            None,
                            None,
                        );
                        if sender.send(Ok(heartbeat_event)).await.is_err() {
                            return;
                        }
                    }
                }
            }
        });

        Ok(Response::new(Box::pin(ReceiverStream::new(receiver))))
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let address: SocketAddr = ADDRESS.parse()?;
    let backend = OperationsBackend::seeded();
    println!("Incident operations gRPC backend listening on {address}");
    Server::builder()
        .add_service(
            OperationsServiceServer::new(backend.clone())
                .accept_compressed(CompressionEncoding::Gzip),
        )
        .add_service(
            IncidentServiceServer::new(backend).accept_compressed(CompressionEncoding::Gzip),
        )
        .serve_with_shutdown(address, async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_stream::StreamExt;

    fn create_request(title: &str) -> IncidentCreateRequest {
        IncidentCreateRequest {
            title: Some(title.to_owned()),
            summary: Some("Customer requests fail before reaching the origin.".to_owned()),
            service: Some("edge-gateway".to_owned()),
            severity: Some(IncidentSeverity::Sev2 as i32),
            commander_id: Some("rsp-1".to_owned()),
            tags: vec!["edge".to_owned(), "customer-impact".to_owned()],
            labels: HashMap::from([("region".to_owned(), "us-west-2".to_owned())]),
        }
    }

    #[tokio::test]
    async fn supports_the_incident_crud_lifecycle() {
        let backend = OperationsBackend::seeded();
        let created = backend
            .create(Request::new(create_request("Gateway request failures")))
            .await
            .expect("create incident")
            .into_inner();
        let id = created.id.clone().expect("created id");

        let fetched = backend
            .get(Request::new(IncidentGetRequest {
                id: Some(id.clone()),
            }))
            .await
            .expect("get incident")
            .into_inner();
        assert_eq!(fetched.title.as_deref(), Some("Gateway request failures"));

        let updated = backend
            .update(Request::new(IncidentUpdateRequest {
                id: Some(id.clone()),
                status: Some(IncidentStatus::Monitoring as i32),
                ..Default::default()
            }))
            .await
            .expect("update incident")
            .into_inner();
        assert_eq!(updated.status, Some(IncidentStatus::Monitoring as i32));

        let toggled = backend
            .toggle_checklist(Request::new(IncidentToggleChecklistRequest {
                incident_id: Some(id.clone()),
                item_id: Some("step-1".to_owned()),
                completed: Some(true),
            }))
            .await
            .expect("toggle checklist item")
            .into_inner();
        assert_eq!(toggled.checklist[0].completed, Some(true));

        backend
            .add_note(Request::new(IncidentAddNoteRequest {
                incident_id: Some(id.clone()),
                author_id: Some("rsp-2".to_owned()),
                message: Some("Rollback completed; watching recovery.".to_owned()),
            }))
            .await
            .expect("add timeline note");
        let timeline = backend
            .timeline(Request::new(IncidentTimelineRequest {
                incident_id: Some(id.clone()),
            }))
            .await
            .expect("get timeline")
            .into_inner();
        assert_eq!(timeline.items.len(), 4);

        let listed = backend
            .list(Request::new(IncidentListRequest {
                status: Some(IncidentStatus::Monitoring as i32),
                ..Default::default()
            }))
            .await
            .expect("list incidents")
            .into_inner();
        assert!(listed
            .items
            .iter()
            .any(|incident| incident.id == Some(id.clone())));

        backend
            .delete(Request::new(IncidentDeleteRequest {
                id: Some(id.clone()),
            }))
            .await
            .expect("delete incident");
        let missing = backend
            .get(Request::new(IncidentGetRequest { id: Some(id) }))
            .await
            .expect_err("deleted incident should be missing");
        assert_eq!(missing.code(), tonic::Code::NotFound);
    }

    #[tokio::test]
    async fn streams_mutations_after_the_requested_revision() {
        let backend = OperationsBackend::seeded();
        let mut stream = backend
            .watch(Request::new(IncidentWatchRequest {
                after_revision: Some(12),
                heartbeat_seconds: Some(30),
            }))
            .await
            .expect("start watch")
            .into_inner();

        let created = backend
            .create(Request::new(create_request("Streaming contract test")))
            .await
            .expect("create incident")
            .into_inner();
        let received = stream
            .next()
            .await
            .expect("stream event")
            .expect("successful stream event");

        assert_eq!(received.kind, Some(ActivityKind::IncidentCreated as i32));
        assert_eq!(received.incident_id, created.id);
        assert_eq!(received.revision, created.revision);
    }
}
