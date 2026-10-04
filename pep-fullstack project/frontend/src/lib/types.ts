export type CaseStatus = "open" | "under_review" | "closed";

export type Case = {
  case_id: string;
  title: string;
  fir_number: string | null;
  station: string | null;
  investigating_officer: string | null;
  notes: string | null;
  status: CaseStatus;
  created_at: string;
  artifact_count: number;
  flagged_count: number;
};

export type IngestResult = {
  artifact_count: number;
  flagged_count: number;
  sources: string[];
  skipped: string[];
};

export type ArtifactType = "message" | "call" | "browser_history" | "image";
export type TimeKind = "authored" | "logged" | "captured";

export type TimeInfo = {
  value: string;
  kind: TimeKind;
  source_field: string;
  tz_inferred: boolean;
  confidence: number;
};

export type Entities = {
  handles: string[];
  phones: string[];
  emails: string[];
  device_ids: string[];
  geo: string | null;
};

export type Artifact = {
  artifact_id: string;
  type: ArtifactType;
  source: string;
  time: TimeInfo;
  actors: string[];
  entities: Entities;
  content_ref: string;
  flags: string[];
};

export type ResolvedActor = {
  actor_id: string;
  label: string;
  identifiers: string[];
  artifact_ids: string[];
  channels: string[];
  flagged: boolean;
};

export type ActorKind = "person" | "phone" | "group" | "handle";

export type GraphNode = {
  actor_id: string;
  label: string;
  kind: ActorKind;
  degree: number;
  flagged: boolean;
  channels: string[];
  artifact_count: number;
  first_seen: string | null;
  last_seen: string | null;
  risk_score: number;
  /** 24 counts, index = UTC hour, for the time-of-day ring. */
  hourly_activity: number[];
  late_night_pct: number;
  /** e.g. "23:00–02:00" — null when the actor has no timed activity. */
  peak_hours: string | null;
  /** True when removing this node would split the graph into more
   * components — the single thread connecting otherwise-separate
   * groups (e.g. one suspect linking several unconnected children). */
  bridge: boolean;
};

export type GraphEdge = {
  source: string;
  target: string;
  artifact_count: number;
  channels: string[];
  channel_counts: Record<string, number>;
  artifact_ids: string[];
  weight: number;
  first_seen: string | null;
  last_seen: string | null;
};

export type GraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type Correlation = { artifact_id: string; score: number };
export type CorrelationMap = Record<string, Correlation[]>;

export type ArtifactAnnotation = { tags: string[]; notes: string };
export type AnnotationMap = Record<string, ArtifactAnnotation>;

export type LeadPriority = "high" | "medium" | "low";

export type Lead = {
  title: string;
  priority: LeadPriority;
  summary: string;
  /** Artifact IDs, already validated by the backend's citation guard. */
  evidence: string[];
  actors: string[];
  recommended_action: string;
};

export type TriageResult = {
  leads: Lead[];
  /** "agent" = the tool-use loop ran; "rules" = deterministic fallback. */
  source: "agent" | "rules";
  /** The model that produced these leads; empty on the rules path. */
  model: string;
  note: string;
  /** Leads the citation guard discarded, with the reason. */
  dropped: { title: string; reason: string }[];
  tool_calls: string[];
};

/** The four lexical/structural signals backend/signals.py scores. Keyed
 * rather than free-form so the UI can't invent a signal the backend
 * doesn't compute. */
export type SignalKey =
  | "isolation"
  | "channel_migration"
  | "contact_escalation"
  | "age_probe";

/**
 * One actor's deterministic signal profile — `backend/signals.py`,
 * served by `GET /cases/{id}/signals`. Every count carries the artifact
 * IDs it was computed from in `signal_evidence`, which is what lets the
 * Persons of interest view cite its own numbers.
 */
export type SignalProfile = {
  actor_id: string;
  label: string;
  identifiers: string[];
  messages_authored: number;
  /** Labels of the actors this one exchanged messages with. */
  counterparties: string[];
  signal_counts: Partial<Record<SignalKey, number>>;
  signal_evidence: Partial<Record<SignalKey, string[]>>;
  late_night_ratio: number;
  escalation_slope: number;
  asymmetry: number;
  risk_score: number;
  /** Source files, e.g. "whatsapp_export.txt" — one per channel. */
  channels: string[];
  /** 24 counts, index = UTC hour, for the time-of-day ring. */
  hourly_activity: number[];
  /** e.g. "23:00–02:00" — null when the actor has no timed activity. */
  peak_hours: string | null;
  /** 7×24 grid: row = weekday (0=Mon), col = hour. For the heatmap. */
  day_hour_activity: number[][];
  /** Messages per calendar week, oldest first. For sparkline trends. */
  weekly_trend: number[];
};

/**
 * One search hit — `backend/search.py`, served by
 * `GET /cases/{id}/search`. `highlights` are `[start, end)` character
 * ranges into `snippet` (not into the source field), so the UI marks
 * exactly what the backend scored.
 */
export type SearchHit = {
  artifact_id: string;
  type: ArtifactType;
  source: string;
  time: string;
  tz_inferred: boolean;
  actors: string[];
  flags: string[];
  /** Payload key the hit came from, e.g. "text", "title", "url". */
  field: string;
  /** Readable name for that field, e.g. "Page title". */
  field_label: string;
  snippet: string;
  highlights: [number, number][];
  score: number;
};

export type SearchResponse = {
  query: string;
  /** The parsed terms — quoted runs stay whole. */
  terms: string[];
  total: number;
  /** True when `total` exceeds the requested limit. */
  truncated: boolean;
  results: SearchHit[];
};

/**
 * The generated case report — `backend/report.py`, served by
 * `GET /cases/{id}/report`. `markdown` is rendered backend-side so the
 * exported file and the on-screen text come from one function and can't
 * drift apart.
 */
export type CaseReport = {
  generated_at: string;
  case: {
    case_id: string;
    title: string;
    fir_number: string | null;
    station: string | null;
    investigating_officer: string | null;
    status: CaseStatus;
    created_at: string;
  };
  evidence: {
    total: number;
    flagged: number;
    flagged_artifacts: {
      artifact_id: string;
      type: ArtifactType;
      source: string;
      time: string;
      flags: string[];
    }[];
    by_type: { type: ArtifactType; label: string; count: number }[];
    /** Grouped by channel — every image is its own file, so those are
     * bucketed as "images" rather than listed individually. */
    sources: { source: string; count: number }[];
    tz_inferred: number;
    first_event: string | null;
    last_event: string | null;
  };
  identities: {
    resolved_actors: number;
    cross_channel: {
      label: string;
      identifiers: string[];
      channels: string[];
      artifact_count: number;
    }[];
  };
  persons_of_interest: {
    label: string;
    identifiers: string[];
    channels: string[];
    risk_score: number;
    messages_authored: number;
    counterparties: string[];
    signal_counts: Partial<Record<SignalKey, number>>;
    evidence: string[];
    late_night_ratio: number;
    escalation_slope: number;
  }[];
  findings: {
    /** False when triage has never been run for this case — the report
     * says so rather than running it as a side effect. */
    triage_run: boolean;
    source: "agent" | "rules" | null;
    model: string;
    confirmed: ReportFinding[];
    flagged_for_review: ReportFinding[];
    rejected_count: number;
    undecided_count: number;
  };
  annotations: {
    count: number;
    items: { artifact_id: string; tags: string[]; notes: string }[];
  };
  /** Limitations, as data rather than prose duplicated in the UI — the
   * view and the exported Markdown state the same caveats. */
  method: string[];
  markdown: string;
};

export type ReportFinding = {
  title: string;
  priority: LeadPriority;
  summary: string;
  evidence: string[];
  actors: string[];
  recommended_action: string;
  note: string;
};

export type AlertSeverity = "critical" | "high" | "medium";

/**
 * One fired alert rule — `backend/alerts.py`, served by
 * `GET /cases/{id}/alerts`. Recomputed per request; `acknowledged` is the
 * only stored state, keyed by the stable `alert_id`.
 */
export type Alert = {
  alert_id: string;
  /** Rule that fired, e.g. "hash_match", "multi_contact". */
  rule: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  /** The rule in plain words — an alert an officer can't interrogate is
   * one they'll learn to ignore. */
  why: string;
  actor: string | null;
  evidence: string[];
  time: string | null;
  acknowledged: boolean;
  /** A number this alert genuinely has — null for rules that have none
   * (a known-hash match is an exact byte match, not a ranking). */
  score: number | null;
  /** What `score` is: "Actor risk", "Correlation", "Channels", … */
  score_label: string | null;
};

export type AlertsResponse = {
  alerts: Alert[];
  total: number;
  open: number;
  acknowledged: number;
  /** Open counts per severity. Deliberately not "new since last visit" —
   * nothing records when an officer last looked. */
  counts: Record<AlertSeverity, number>;
};

/**
 * One audit entry — `backend/audit.py`, served by
 * `GET /cases/{id}/audit`. Append-only: there is no endpoint that edits
 * or deletes one.
 */
export type AuditEvent = {
  /** Process-wide increasing sequence, so reordering would be visible. */
  seq: number;
  at: string;
  case_id: string;
  /** e.g. "evidence_ingested", "lead_decision", "alert_acknowledged". */
  action: string;
  category: string;
  summary: string;
  /** The case's investigating officer, or "unattributed" — this build
   * has no user model, so an entry cannot say who actually clicked. */
  actor: string;
  detail: Record<string, unknown>;
  artifact_ids: string[];
};

export type AuditResponse = {
  events: AuditEvent[];
  total: number;
  shown: number;
  truncated: boolean;
  counts: Record<string, number>;
  categories: string[];
};

/** An env-derived value plus how it's set — `backend/settings.py`. */
export type EnvSetting = {
  env: string;
  value: string;
  default: string;
  overridden: boolean;
};

/**
 * Effective runtime configuration — `GET /settings`. A reader, not a
 * control panel: nothing here persists, so it reports what's in force and
 * how to change it, and never returns a secret (API keys are booleans).
 */
export type Settings = {
  note: string;
  triage: {
    provider_setting: EnvSetting;
    /** What the provider setting resolves to given the keys present now —
     * "groq", "anthropic", or "rules" when no key is available. */
    effective_provider: string;
    will_use_agent: boolean;
    groq_key_present: boolean;
    anthropic_key_present: boolean;
    groq_model: string;
    anthropic_model: string;
    groq_reasoning_effort: string;
    groq_max_tokens: number;
    groq_synthesis_max_tokens: number;
    groq_tool_rounds: number;
  };
  scoring: {
    concern_threshold: number;
    late_night_hours: number[];
    correlation_window_hours: number;
    correlation_top_k: number;
    alert_multi_contact_min: number;
    alert_cross_channel_min: number;
    alert_channel_migration_min: number;
    alert_call_link_score: number;
    /** pHash Hamming-distance cutoff for near-duplicate image matching. */
    phash_max_distance: number;
  };
  data: {
    synthetic_only: boolean;
    persistence: string;
    auth: string;
    audit_scope: string;
    seed_case: string;
  };
};

export type GroomingStage =
  | "contact"
  | "trust_building"
  | "isolation"
  | "channel_migration"
  | "escalation"
  | "contact_request";

export type StageBlock = {
  stage: GroomingStage;
  label: string;
  description: string;
  start_date: string;
  end_date: string;
  duration_days: number;
  message_count: number;
  artifact_ids: string[];
  signal_matches: { artifact_id: string; signal: string; matched: string }[];
};

export type LeadDecisionKind = "confirmed" | "rejected" | "flagged";
export type LeadDecision = { decision: LeadDecisionKind; note: string };

/**
 * Dashboard aggregates. Deliberately no trend deltas — nothing records
 * history, so "+12% from last month" could only be invented. See
 * backend/stats.py.
 */
export type DashboardStats = {
  totals: {
    cases: number;
    open: number;
    under_review: number;
    closed: number;
    artifacts: number;
    flagged: number;
  };
  evidence_by_type: { type: ArtifactType; label: string; count: number }[];
  recent_activity: {
    artifact_id: string;
    case_id: string;
    case_title: string;
    type: ArtifactType;
    source: string;
    time: string;
    tz_inferred: boolean;
    preview: string;
    flagged: boolean;
  }[];
  flagged_items: {
    artifact_id: string;
    case_id: string;
    case_title: string;
    item: string;
    type: ArtifactType;
    reason: string;
    time: string;
  }[];
  insight: {
    case_id: string;
    case_title: string;
    actor: string;
    risk_score: number;
    channels: string[];
    counterparties: number;
    late_night_ratio: number;
    signal_summary: string;
    headline: string;
    evidence: string[];
  } | null;
};
