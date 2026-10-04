# Build Prompt — "Counter-Hypothesis & Exculpatory Review" (ACPIA)

Paste this to the coding agent working inside the ACPIA repo. It has full context of the codebase
(FastAPI `backend/`, Next.js `frontend/`, in-memory store, canonical `Artifact` schema, audit log,
citation guard, triage agent, `signals.py` with echo suppression, `report.py`, `alerts.py`).

---

## The problem this solves

Every other part of ACPIA is built to *find concern*. That is a bias by construction: a tool that
only ever assembles the case **for** guilt will, sooner or later, accuse the wrong person — or
mis-assign who is the victim and who is the aggressor. In a child-protection case that error is
catastrophic in both directions (a real predator excused, or an innocent person railroaded).

This feature adds the missing half: for every lead and finding, ACPIA also states the **strongest
innocent explanation**, what evidence would **refute** the concern, how well the concern is actually
**corroborated**, and whether the **victim/aggressor roles** are as clear as the headline implies.
It is the presumption of innocence, made a first-class part of the analysis instead of left to the
officer to remember.

## Scope guardrail (read first — this is a child-protection tool)

- This is **investigative rigor, not victim-blaming.** For a minor, *consent is never a defense* and
  the feature must never frame it as one. It does **not** question whether a child "wanted" contact,
  "provoked" it, or is culpable for being groomed.
- What it *does* question: **corroboration** (is this claim backed by evidence, or a single
  uncorroborated assertion?), **identity** (are we sure who authored this?), **role accuracy** (is
  the person we're treating as the aggressor actually the aggressor, or is this two minors / a
  mutual peer situation / a mislabelled thread?), and **alternative explanations** for a given
  artifact.
- Output is framed as *"here is what would have to be true for the innocent reading"* and *"here is
  how strong the concern is,"* never as a verdict for or against anyone.

## Where this runs in the pipeline

Right after the **AI relevance filter** narrows the evidence to the case-relevant messages
(see `FEATURE_recovery_relevance_prompt.md`), the officer sees the relevant thread(s). This feature
adds the **next beat**: a **Role Determination** stage that asks, over exactly those relevant
messages, *who is actually the person at risk here?* — and returns one honest, evidence-backed
verdict instead of assuming it.

## Role Determination — the headline stage (three outcomes)

Over the relevant messages, ACPIA classifies the relationship into exactly one of three verdicts,
each with cited evidence and a confidence grade. It never assumes the girl is the victim by default.

1. **Child is the person at risk** (adult → minor grooming). The default-looking case, but it must
   be *earned* from the evidence: an adult actor originates the concern signals (isolation,
   channel-migration asks, age probes, escalation) against a minor. This is what the current bundle
   shows for `swim_coach_rk`.
2. **The "man"/older-account is the one at risk or wrongly accused.** Real and must be detectable —
   framed precisely so it can never excuse an actual predator:
   - **Sextortion / posing-as-a-minor:** the "girl" persona is actually an aggressor (often an
     organised actor) — signals are *extortion, threats, demands for money/images after contact*,
     and the identity/behaviour is inconsistent with a real child. The adult is the target.
   - **False allegation:** the concern against the man rests on a single uncorroborated assertion
     with no supporting artifacts, or artifacts that contradict it (timeline, identity).
   - **Catfishing / mistaken identity:** the account attributed to the man wasn't authored by him,
     or the "child" account is an adult.
   > Guardrail: an adult who actually groomed a minor is **never** reclassified as a victim. This
   > outcome fires only on extortion-of-the-adult, unsupported allegation, or identity error — and
   > a minor's "consent" is never part of this reasoning.
3. **Unclear / both wrong / needs human review.** The scores are too close to call, roles are
   ambiguous (e.g. two minors, mutual peer conduct), or the evidence is too thin either way. The
   tool says so plainly rather than picking a side — this outcome is a feature, not a failure.

Each verdict shows: the evidence that drove it, the corroboration grade, and *what would change it*.

## What to build

A **counter-hypothesis + role-determination layer** that runs after relevance and threads into the
report, plus a "Role & confidence" surface in the UI. Capabilities:

0. **Role Determination verdict** (above) — the primary output, one of the three outcomes, cited and
   guarded, with a confidence grade and "what would change this."
1. **Innocent explanation, per lead.** For each lead the triage engine produces, generate the most
   plausible non-concerning explanation of the same artifacts, and list the specific evidence that
   would confirm or kill that explanation. Cited, guarded, same as leads.
2. **Corroboration grading.** Label every finding by how well it's supported:
   `corroborated` (independent evidence across ≥2 artifacts / channels / actors),
   `single-source` (rests on one artifact or one person's assertion),
   `contested` (other artifacts point the other way). Show the grade on the lead, not buried.
3. **Role-symmetry test.** ACPIA already scores concern per actor with echo suppression. Run it
   **symmetrically** and report honestly when roles are ambiguous: e.g. if the presumed victim also
   originates concern signals toward a third party, or if two actors score close enough that "who is
   the aggressor" is not clear-cut. Never silently pick a side the numbers don't support.
4. **Exculpatory surfacing.** Actively search the evidence for artifacts that *contradict* a lead —
   timeline contradictions, identity ambiguity (was it really this handle?), signs the parties are
   peers rather than adult→child — and present them next to the lead instead of leaving them for the
   defense to find.

## Non-negotiable honesty guardrails

- **Symmetry with the rest of the app.** Counter-hypotheses are cited and run through the existing
  **citation guard**; an uncited counter-claim is dropped exactly like an uncited lead.
- **Deterministic fallback.** With no API key it still produces corroboration grades and the
  role-symmetry test from `signals.py` arithmetic, cited identically — mirror the triage fallback
  ladder. The AI adds nuance; it is never the only path.
- **It never hides the concern.** Surfacing the innocent reading never suppresses or downgrades the
  original lead — both are shown, side by side. The officer weighs them; the tool doesn't decide.
- **Auditable.** Log when a counter-hypothesis is generated and when an officer marks a lead
  contested/corroborated, via the existing audit log.
- **Confidence is data, not vibes.** Corroboration grade is computed from artifact counts / channel
  spread / echo-ownership, and the UI shows *why* a finding is single-source or contested, not just
  a colour.

## Backend

- **`backend/counter.py`** (new): given a relationship/lead + the case store, produce
  `{role_verdict: enum(child_at_risk | adult_at_risk_or_accused | unclear),
  role_reason, role_evidence_ids[], role_confidence, what_would_change_it,
  innocent_explanation, refuting_evidence_ids[], corroboration: enum, role_ambiguity: {...},
  exculpatory_ids[]}`. AI path reuses the triage tool-use loop (read-only tools) with a prompt that
  asks for the role verdict + the strongest innocent account + what would refute the concern;
  guarded. Rule-based path derives the verdict from `signals.py`: who *originates* concern signals
  (echo-ownership) sets the aggressor; an extortion/threat lexicon + identity-inconsistency checks
  trigger `adult_at_risk_or_accused`; close scores or thin evidence → `unclear`.
- **`backend/signals.py`**: add a small **extortion/threat lexicon** (demands for money or images,
  threats to leak, "I'll send this to your family") and an identity-inconsistency signal, so the
  `adult_at_risk_or_accused` (sextortion/posing) path is deterministic, not AI-only.
- **`backend/signals.py`**: expose the symmetric per-actor scoring already implicit in the profiles,
  and a helper that reports when two actors' concern scores are within a closeness band (role
  ambiguity) — reuse `CONCERN_THRESHOLD`, don't introduce a second line.
- **`backend/report.py`**: add a **"Alternative explanations & confidence"** section — for each
  finding, its corroboration grade and the innocent reading, and a case-level note on any role
  ambiguity. This is what makes the exported report court-defensible; render it in both the view and
  the Markdown from one function (existing pattern, so screen and file can't drift).
- **`backend/models.py` / `store.py`**: carry the counter-hypothesis + corroboration grade on the
  lead; add an officer flag to mark a lead `contested`.
- **`backend/audit.py`**: log `counter_hypothesis_generated`, `lead_marked_contested`,
  `lead_marked_corroborated`.
- **`backend/main.py`**: `GET /cases/{id}/leads/{lead_id}/counter` and a `POST` to set the officer's
  contested/corroborated flag. Existing route/error conventions.

## Frontend

- **Role Determination card** shown right after the relevance results for a relationship: the
  verdict (child at risk / adult at risk or accused / unclear) as a clear, neutral banner, the
  driving evidence chips (click-through to Timeline), the confidence grade, and "what would change
  this." When `unclear`, say so plainly. Officer can agree / override the verdict (recorded).
- On the **Triage** panel, each lead gains a **"Confidence & counter-evidence"** expander:
  corroboration badge (`corroborated` / `single-source` / `contested`), the innocent explanation in
  plain language, the refuting/exculpatory evidence chips (click-through to Timeline like all
  citations), and a role-ambiguity note when present. Officer controls: mark contested / mark
  corroborated.
- In the **Report** view, render the new "Alternative explanations & confidence" section.
- Visual language stays neutral — this is a fairness lens, not a "this person is innocent" banner.

## Acceptance criteria (verify, don't just build)

- Each relationship gets a **role verdict** (one of the three), cited and guarded, with a confidence
  grade and "what would change it"; the current bundle's suspect→child case returns
  `child_at_risk`, not `unclear`.
- The rule-based path can produce `adult_at_risk_or_accused` on a seeded sextortion/false-allegation
  example (add one to `data/generate_case.py` so the outcome is demonstrable, with manifest ground
  truth), and does **not** fire it on the genuine predator→child relationship.
- Every lead gets a corroboration grade and an innocent-explanation, cited and guarded; an uncited
  counter-claim is dropped.
- Works with no API key (rule-based grades + role-symmetry), cited identically to triage.
- The role-symmetry test flags at least the intended ambiguous case in the synthetic bundle, and
  does **not** flip a clearly one-sided predator→victim relationship.
- Surfacing a counter-hypothesis never removes or downgrades the original lead.
- The report's confidence section renders identically on screen and in exported Markdown.
- Nothing in the feature frames a minor's consent as exculpatory (review the copy for this
  explicitly).

## One-line pitch this enables

*"After the AI narrows to the messages that matter, ACPIA asks the question every investigation
turns on — who is actually the person at risk? It returns one evidence-backed verdict: the child,
the adult (sextortion or a false allegation), or 'not clear, needs review' — and it argues the other
side of its own case to get there. So the tool that finds predators is also the tool that protects
the wrongly accused, and its reports survive a defense lawyer instead of handing one the win."*
