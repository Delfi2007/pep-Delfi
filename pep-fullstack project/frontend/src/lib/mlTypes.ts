/** Shapes served by backend/ml_service.py (the trained PAN12 models). */

export type Confusion = { tn: number; fp: number; fn: number; tp: number };

export type Metrics = {
  n?: number;
  positives?: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  "f0.5": number;
  roc_auc?: number;
  pr_auc?: number;
  confusion_matrix?: Confusion;
};

export type MlModelSummary = {
  id: string;
  label: string;
  family: string;
  live: boolean;
  thresholds: { t1_stage1: number; t2_stage2: number };
  author: Metrics & { confusion_matrix: Confusion };
  stage1: Metrics;
  stage2: Metrics;
  ece_stage1?: number;
  ece_stage2?: number;
  train_seconds?: number;
  ms_per_conversation?: number;
  model_size_mb?: number;
};

export type Curve = {
  roc: { fpr: number[]; tpr: number[] };
  pr: { recall: number[]; precision: number[] };
};

export type MlModelDetail = {
  model: string;
  label: string;
  thresholds: { t1_stage1: number; t2_stage2: number };
  test_final_author_level_PAN12: Metrics & { confusion_matrix: Confusion };
  curves?: Record<"stage1" | "stage2" | "author", Curve>;
  calibration?: Record<
    "stage1" | "stage2",
    {
      ece: number;
      brier: number;
      reliability: { bin: number; confidence: number; accuracy: number; count: number }[];
    }
  >;
  operating_points?: {
    t2: number;
    precision: number;
    recall: number;
    f1: number;
    "f0.5": number;
    tp: number;
    fp: number;
  }[];
};

export type SignalHits = Record<string, string[]>;

export type MlThreadAuthor = {
  actor_id: string;
  label: string;
  score: number;
  messages: number;
  signals: SignalHits;
  flag_tuned: boolean;
  flag_triage: boolean;
};

export type MlThread = {
  thread_id: string;
  participants: string[];
  message_count: number;
  sources: string[];
  first: string;
  last: string;
  score: number;
  flag_tuned: boolean;
  flag_triage: boolean;
  authors: MlThreadAuthor[];
  ranked_instigator: string | null;
  top_terms: { term: string; weight: number }[];
  signals: SignalHits;
  artifact_ids: string[];
};

export type MlActor = {
  actor_id: string;
  label: string;
  max_participant_score: number;
  max_thread_score: number;
  threads: number;
  ranked_instigator_in: number;
  flag_tuned: boolean;
  flag_triage: boolean;
};

export type MlCaseAnalysis = {
  model: string;
  label: string;
  thresholds: { t1: number; t2: number };
  thread_count: number;
  message_count: number;
  latency_ms: number;
  threads: MlThread[];
  actors: MlActor[];
};

export type MlCompareRow = {
  model: string;
  label: string;
  latency_ms: number;
  threads_over_triage: number;
  threads_over_tuned: number;
  top_actor: string | null;
  top_actor_score: number | null;
  actors_flagged_tuned: string[];
  actors_flagged_triage: string[];
  truth?: {
    offender_rank: number | null;
    caught_tuned: boolean;
    caught_triage: boolean;
    false_flags_tuned: string[];
    false_flags_triage: string[];
  };
};

export type MlCompare = { ground_truth_offender: string | null; models: MlCompareRow[] };

export type Hist = { bin: string; count: number }[];

export type MlDatasets = {
  pan12: {
    name: string;
    source: string;
    task_page: string;
    notes: string[];
    splits: {
      split: string;
      conversations: number;
      conversations_with_predator: number;
      positive_rate_pct: number;
      authors: number;
      predators: number;
      predator_rate_pct: number;
      messages: number;
      messages_per_conversation_median: number;
    }[];
    messages_per_conversation: { with_predator: Hist; without_predator: Hist };
    conversations_per_predator: { mean: number; median: number; max: number };
  };
  synthetic_eval: {
    description: string;
    results: Record<
      string,
      { "at_0.5": Metrics; at_tuned_t1: Metrics; t1: number; stage2_instigator_accuracy: number }
    >;
  };
};

export type MlGov = {
  ncrb: {
    source: { name: string; compiled_by: string; url: string; original: string; caveat: string };
    heads: Record<string, string>;
    national: ({ year: number; total: number } & Record<string, number>)[];
    reported_later: { year: number; total: number; source: string; url: string }[];
    trend: { annual_growth_pct: number; method: string };
    latest_year: number;
    states_latest: {
      state: string;
      total: number;
      rate_per_lakh_children: number | null;
      child_population_lakh: number | null;
    }[];
    kerala: { year: number; total: number }[];
    clusters: {
      k: number;
      year: number;
      features: string;
      items: {
        cluster: number;
        states: string[];
        mean_rate_per_lakh_children: number;
        dominant_crime_head: string;
      }[];
    };
  };
  ncmec: {
    source: { name: string; url: string; caveat: string };
    years: { year: number; countries: Record<string, number>; global_million: number | null }[];
  };
};

export type MlHashing = {
  n_images: number;
  threshold: number;
  n_impostor_pairs: number;
  hashes: Record<string, string>;
  transforms: Record<string, string>;
  per_transform: Record<string, Record<string, { match_rate: number; mean_distance: number | null }>>;
  summary: Record<
    string,
    { overall_match_rate: number; false_match_rate: number; roc_auc: number | null }
  >;
};

/** Plain-language names for the behaviour-signal families (ml/ml_signals.py). */
export const SIGNAL_LABELS: Record<string, string> = {
  age_probe: "Age probing",
  secrecy: "Secrecy",
  isolation: "Isolation",
  platform_migration: "Platform migration",
  meeting: "Meeting",
  flattery: "Flattery",
  relationship: "Relationship framing",
  image_request: "Photo request",
  sexual_term: "Sexual term",
};

export const fmt = (v: number | null | undefined, d = 3) => (v == null ? "—" : v.toFixed(d));
export const pct = (v: number | null | undefined, d = 1) =>
  v == null ? "—" : `${(v * 100).toFixed(d)}%`;
export const int = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("en-IN"));
