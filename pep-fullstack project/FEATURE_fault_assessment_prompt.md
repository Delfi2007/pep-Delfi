# Build Prompt — "Role & Fault Assessment" page (Groq-powered) (ACPIA)

Paste this to the coding agent working inside the ACPIA repo. It has full context of the codebase
(FastAPI `backend/`, Next.js `frontend/`, in-memory store, canonical `Artifact` schema, audit log,
citation guard, the Groq/Anthropic triage tool-use loop in `triage.py`, `signals.py` with echo
suppression, `report.py`).

---

## What to build

A **separate case view, "Role Assessment"** (its own tab in the *Per case* nav group), powered by
**Groq AI** (the same provider-swappable loop `triage.py` already uses — `openai/gpt-oss-120b`,
free tier). For each relationship in the case it answers, with evidence: **who originated the
concerning conduct (the aggressor) and who was on the receiving end (the target)** — and how sure it
is. It is decision-support for the officer, not a verdict.

## Critical framing guardrail (read first — this is what keeps the feature defensible)

- **The AI never declares legal guilt or "fault" as a verdict.** It assesses **behavioral role**:
  who *initiated* isolation / channel-migration / age-probing / sexual escalation, and who
  *received or echoed* it. The word "fault" in the pitch maps to *"who is the aggressor,"* not to a
  finding of criminal guilt. The page states plainly: *"Role assessment — investigative
  decision-support. Not a determination of guilt; the officer and the court decide."*
- **For a minor, consent is never a defense and is never assessed.** The page never evaluates whether
  a child "wanted," "encouraged," or is culpable for contact. It assesses **who drove the conduct**,
  full stop.
- **It must be able to say "unclear."** If the evidence doesn't cleanly separate aggressor from
  target (e.g. two minors, mutual/peer conduct, close scores), the page reports **ambiguous** with
  reasons — never a forced pick.
- **Grounded in echo suppression, not vibes.** ACPIA already establishes that within a thread,
  whoever uses a signal *first* owns it and later use by the other party is an echo that doesn't
  score. That is exactly the "who originated it" evidence — the AI assessment must be anchored to it,
  not free-floating.

## How the assessment works

- **Backend `assessment.py`** (new): for each concerning relationship, run the **Groq tool-use loop**
  (reuse `triage.py`'s loop and tools — signal profiles, message thread, timeline slice, graph
  neighbourhood, single artifact) with a prompt that asks specifically: *who originated each
  concerning behavior, who echoed/received it, and what is the strongest opposing reading.* Returns
  per relationship:
  `{aggressor_actor, target_actor, confidence: high|medium|low|ambiguous, originating_evidence_ids[],
  counter_reading, ambiguity_reason?}`.
- **Citation guard applies** — every `evidence_id` is checked against the store; an assessment citing
  unknown or no evidence is dropped and the reason surfaced, identical to triage leads.
- **Rule-based fallback** off `signals.py` echo-ownership: with no Groq key, the page still assigns
  roles from *who owns each first-use signal* and grades confidence from the score gap — cited
  identically. The Groq path adds natural-language reasoning and the counter-reading; it is never the
  only path. Mirror the existing triage fallback ladder exactly.
- **Confidence is computed, shown, and explained:** derived from the concern-score gap between the
  two actors and how many independent signals point the same way — `ambiguous` when the gap is inside
  the closeness band. Show *why*, not just a label.

## Honesty guardrails (same ethic as the rest of the app)

- **Both readings are always shown.** The assessment names an aggressor *and* prints the strongest
  opposing reading beside it. The officer weighs them; the tool doesn't decide.
- **Auditable.** Log `role_assessment_run` and any officer override (confirm / dispute / mark
  ambiguous) to the existing audit log, with the cited artifact ids.
- **The page says what it is.** A persistent banner: decision-support, not a verdict; consent of a
  minor is never assessed; roles can be ambiguous.
- **No new threshold.** Reuse `CONCERN_THRESHOLD` and the existing closeness band from `signals.py` —
  the People, Triage, and this page must never disagree about who is of concern.

## Backend

- `backend/assessment.py` — the Groq assessment + rule-based fallback described above.
- `backend/signals.py` — expose echo-ownership per signal (who used it first) and the score-gap /
  closeness helper, reused (don't duplicate the threshold).
- `backend/models.py` / `store.py` — carry the assessment result and an officer verdict flag
  (confirm / dispute / ambiguous) per relationship.
- `backend/audit.py` — `role_assessment_run`, `role_assessment_ruled`.
- `backend/report.py` — optional: fold the confirmed role assessments into a report subsection,
  rendered from one function for screen+Markdown parity.
- `backend/main.py` — `GET /cases/{id}/assessment`, `POST /cases/{id}/assessment/{rel_id}` (officer
  verdict). Existing route/error conventions; dead case id degrades via `fetchJson`.

## Frontend

- New route + **"Role Assessment"** tab in the *Per case* sidebar group and case `TabBar`.
- `src/components/assessment/` — one card per concerning relationship:
  - the two actors, with the assessed **aggressor / target** roles and a confidence chip
    (high / medium / low / **ambiguous**),
  - the **originating evidence** chips (who used each signal first) — click-through to the Timeline,
  - the **counter-reading** in plain language,
  - the model/source line (`groq · gpt-oss-120b` or `rule-based`), evidence-query count, and what the
    citation guard dropped — same transparency strip as Triage,
  - officer controls: **Confirm / Dispute / Mark ambiguous.**
- The persistent decision-support / no-verdict / consent banner at the top of the page.
- Neutral visual language — no red "guilty" styling; this is an assessment, not an accusation.

## Acceptance criteria (verify, don't just build)

- On the synthetic bundle, the page assigns `swim_coach_rk` as aggressor and the minors as targets
  with high confidence, anchored to echo-ownership evidence — and does **not** assign any child an
  aggressor role.
- The intended ambiguous/peer case (if seeded) returns `ambiguous` with a stated reason, not a
  forced pick.
- Runs against Groq live **and** falls back to rule-based with no key, cited identically; an uncited
  assessment is dropped by the guard.
- Every assessment shows a counter-reading; the aggressor claim never appears without it.
- Officer verdicts persist and land in the audit log.
- Copy review confirms nothing assesses a minor's consent, and the no-verdict banner is present.

## One-line pitch this enables

*"ACPIA doesn't just flag concern — it uses Groq to assess who actually drove it, anchored to
evidence of who said what first, with a confidence level and the opposing reading shown beside it.
It names the aggressor when the evidence is clear, says 'unclear' when it isn't, and never pretends
to be the verdict — that stays with the officer."*
