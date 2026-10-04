# ACPIA — Agentic Child Protection Investigation Assistant

HacKP 2026 · Kerala Police Cyberdome. Build plan: [../ACPIA_Plan.md](../ACPIA_Plan.md). Official brief: [../HACKATHON_CONTEXT.md](../HACKATHON_CONTEXT.md).

## Status

Roughly: **Day 1 done, Day 2 done, Day 3 (agentic triage) done and running live against Groq.** All eight case views — Timeline, Graph, Persons of interest, Evidence search, Alerts, Triage, Report, Audit log — work end to end on the real 736-artifact bundle, plus a global Settings page, and the demo script's last beat (click an evidence ID → land on the source line) works from every view that cites an artifact. **Nothing in the sidebar is greyed out any more** — the "Planned" group is gone, because everything in it now exists. What's left before the pitch is **one** thing: confirming the agent's lead quality against a live model. The prompt fix for it is written but has not been run against a model — item 1 of "What's next" says exactly what's owed. Everything past that list is real but not currently blocking anything.

### Done

**Data**
- `data/generate_case.py` — fully synthetic evidence bundle (no real people, no real content): 339 WhatsApp messages / 6 conversations, 90 Instagram DMs, 63 call log entries, 201 browser history rows, 45 images (3 hash-flagged). Deterministic (seed 42); `data/case_manifest.json` is the regenerable ground truth.
- Cross-channel identity bridge is real, not scripted-in: the predator's phone number is shared as plain text inside an Instagram DM (a genuine channel-migration message), so identity resolution finds it the same way it would find it in a real case.
- Calls are anchored 8–45 minutes after real escalation-stage messages (not independently randomized), so the correlation engine has an actual "message → call" pattern to detect.

**Backend (FastAPI)**
- Case model: create/list/get, in-memory (`store.py`), no database. **Auto-seeded on startup**: if the store is empty when the backend boots, it ingests `data/case_bundle` straight off disk into a canonical "Op Riverbank" demo case (`_seed_demo_case` in `main.py`) — so a crash, reboot, or the port-8000 ghost-socket issue below never leaves the dashboard empty. Opt out with `ACPIA_SKIP_SEED=1`.
- Five parsers (`parsers.py`) → the canonical artifact schema from the plan, with source-aware timestamp confidence (WhatsApp/EXIF get `tz_inferred: true` since neither format carries a timezone; Instagram/call-log/browser-history get high confidence from their explicit UTC offsets).
- Hash flagging — SHA-256 against `known_hashes.txt` at ingest time.
- Identity resolution (`identity.py`) — union-find, scoped so only message/image artifacts' *entities* license a merge (self-reported identifiers), never a call's caller/callee.
- Correlation engine (`correlation.py`) — windowed proximity + cross-modality scoring, powers "Linked Artifacts."
- Entity graph (`graph.py`, networkx) — nodes are resolved actors, edges are shared-artifact co-occurrence.
- Investigator annotations (`ArtifactAnnotation`) — tags (add/remove) and notes per artifact, separate from system-derived hash flags.

**Frontend (Next.js 16)**
- **Case shell redesign** (`CaseHeader` + `TabBar`): breadcrumb, case title with status, FIR / opened date / investigating officer, an Export action, and a five-tile stat strip, above underline tabs for the eight views. The pill `SegmentedControl` didn't survive eight options — it either squeezed the labels or ran off the side — so the case views moved to underline tabs; the pill control stays where there are two or three choices (theme, the Connections People/Platforms switch).
  **Three tiles are deliberately narrower than they first read**, and their labels say so. *Persons of interest* counts actors at or above the concern threshold, not every actor — counting all of them under that label would put the victims in the number, which is the exact thing the threshold exists to prevent. *Late-night share* and *Highest risk score* are one actor's figures, so both name that actor: the case doesn't have an escalation slope, an actor does, and a per-actor number shown as a case metric is how a dashboard starts lying. On the Alerts tab the third tile swaps to *Open alerts*, fed by the view itself rather than a second request.
- **App shell**: persistent left sidebar + slim top bar, every page full-width inside it. The sidebar reads *Dashboard / Cases*, then *Per case* (the eight views inside a case), then *System* (Settings). The *Planned* group is gone: it held items rendered disabled-and-labelled rather than as links, on the principle that a nav item which 404s mid-pitch is worse than one admitting it isn't built — and it doubled as an honest roadmap. That mechanism is still in `Sidebar.tsx` (a `NavItem` without an `href` renders disabled) and is worth keeping for whatever gets stubbed next, but nothing uses it right now.
- **Dashboard** (`/`): stat cards, recent activity, an AI case insight drawn from `signals.py` **with its artifact citations shown**, recent cases, an evidence-by-type donut, and a flagged-items table. Every figure is computed from ingested evidence by `backend/stats.py`. There are deliberately **no trend deltas** ("+12% from last month", "+53 this week") — nothing in ACPIA records history, so those could only be invented, and a fabricated number on a dashboard is exactly the failure the citation guard exists to prevent. Real trends need an ingest-time audit log first.
- **Cases** (`/cases`): searchable case list. Search is scoped to case fields (title, FIR, station, officer) and says so in its placeholder — a box that quietly searches less than it implies is worse than one that states its scope. Searching *inside* a case's evidence is the Search tab (below); these are deliberately separate, since "find the case" and "find the line" are different questions.
- New Case → Case Detail, Apple-idiom design tokens throughout.
- **Light / Dark / System theme switch** (top right), persisted in `localStorage` and applied pre-paint by an inline script so there's no flash of the wrong theme on load. The `prefers-color-scheme` rule is scoped `:root:not([data-theme="light"])` so an explicit Light choice still wins on a dark-set machine.
- **Platform identity** lives in one module (`lib/platforms.ts`) so the timeline, detail panel and graph can't disagree. WhatsApp and Instagram carry their real marks — an investigator scanning a mixed timeline recognises them faster than any label, which is the whole cross-channel story this case tells. Call log / browser / images stay typographic: they're device artefacts, not third-party platforms, and borrowing brand iconography for them would be noise.
- **Persons of interest** (`People` tab in a case) — the deterministic layer given its own view, with no agent involved: per-actor risk score with a bar so the gap between actors reads without comparing decimals, the resolved identifiers and channels side by side (the cross-channel identity story, stated rather than implied), the five arithmetic terms (messages authored, contacts, late-night %, escalation slope, asymmetry), and each signal count expandable into the artifact IDs it was computed from — click one and the Timeline opens that line, same click-through as the Triage citations.
  Laid out as a working screen with a right-hand rail: a *Case summary* (assembled from the profile's own numbers), *Top risk factors*, and a *Connections* card — a small radial view of who the top actor reaches, drawn from the same `/graph` payload the Graph view uses, with a People/Platforms toggle and a hand-off to the full graph. The summary card is **not** badged AI: it's arithmetic over the signal profile, and calling it AI two inches under a banner reading "no model involved" would contradict the thing it sits beside.
  Two decisions carry this screen, both about who it is allowed to accuse. **It's a threshold, not a leaderboard**: ranking all eight actors under a heading reading "persons of interest" would put three 12-year-olds at ranks 2–4, because echo suppression leaves them a ~0.10 residual from the late-night term against the suspect's 1.0. A number that small is noise, and presenting it as a rank reads as an accusation. Only actors at or above the concern threshold are named; everyone else is listed below as case contacts with the reason stated. **And the threshold is the one triage already uses** (0.25, from `rule_based_leads`) — if this view drew its own line, the People tab and the Triage tab could disagree about who is of concern in the same case.
- **Evidence search** (`Search` tab in a case) — full-text across the artifact store, server-side in `backend/search.py`. It searches every text-bearing field the parsers produce — message bodies, page titles and URLs, image filenames, EXIF artist, SHA-256, call participants — and each result row says which field it matched in, so a hit on a URL never masquerades as a hit on something someone wrote. Substring matching rather than stemming, because most of what gets searched here is identifiers (`swim` finds `swim_coach_rk`, `img_00` finds the flagged images) and a stemmer would help with prose and hurt with handles. Quoted runs stay whole; separate words must all match, though not in the same field. Filter by type and flagged-only; click a result and the Timeline opens that line.
  **Ranking is purely lexical — flagged artifacts are deliberately not boosted.** It's tempting to float the hash-flagged images to the top, but then the ranking silently encodes a judgement and an unrelated query keeps returning them anyway. Flagging is a filter the officer controls, not a thumb on the relevance scale. Highlight offsets are computed backend-side and returned with each hit, so the UI marks exactly what was scored instead of re-running the match client-side and highlighting something the ranking never saw. When there are more matches than the page holds it says so ("217 matches · showing the 50 most relevant") rather than presenting a page as the whole result set.
- **Settings** (`/settings`, global) — the effective runtime configuration, served by `backend/settings.py`. Four sections: appearance, triage engine (provider preference and what it actually resolves to, models, reasoning effort, token budgets, tool rounds), detection & scoring (concern threshold, late-night window, correlation window, every alert threshold), and data & privacy (synthetic-only, in-memory, no auth, audit scope, seed behaviour).
  **It's a reader, not a control panel, and the page says why.** Nothing in this build persists, so a toggle would store its state in the same RAM a restart wipes — invented state of exactly the kind the rest of the app refuses. So engine settings show what's in force plus how to change it (an env var and a restart), each marked *default* or *overridden*. The one genuine control is the colour theme, because it's the one setting that actually persists (localStorage), and it reuses the existing `ThemeToggle` so the top bar and this page can't disagree.
  Two properties worth the line: **every value is imported from the module that owns it** — the threshold from `signals.py`, the correlation window from `correlation.py`, the budgets from `triage.py` — so a number here cannot drift from the one in force; duplicating them as literals is the one way a config screen lies. And **secrets are never returned**: the API-key fields are booleans, presence only. A settings screen that echoed a key back would be a credential leak dressed as transparency.
  It also answers the question the demo actually raises — "is the AI running?" — honestly: with no key present it reads **Rule-based fallback**, and names the deterministic path rather than implying an agent ran.
- **Audit log** (`Audit` tab in a case) — append-only record of what happened to a case, in `backend/audit.py`. Enforced by interface: there is `record` and there are readers, and no route that edits or deletes an entry. It logs **state changes only** — evidence ingested, triage run, a lead ruled on, a tag or note saved, an alert acknowledged, a report exported — each with a process-wide sequence number so reordering would be visible, and the artifact IDs involved, which open on the Timeline. Filterable by category.
  The panel is a two-column working screen: search, severity filter chips, a sort control, and cards carrying a severity rail, the rule name, "why this fired", cited evidence and Acknowledge/Reopen — beside a rail with a severity donut, the top actor's risk factors, and the actions that exist. **The per-alert score column is populated only where a real number exists** — an actor's risk score, a correlation score, a channel span. A known-hash match has none (it's an exact byte match, not a ranking), so its slot stays empty rather than being filled to make the column look tidy. Same reason there's no *Low* severity chip: no rule emits one, and a "0 Low" counter implies a band the engine doesn't have. Alerts tied to a moment show their timestamp; actor-level rules describe a case-wide pattern and say so instead of borrowing one. "Escalate" and "Add note" are absent from the actions card because nothing behind them exists — a button that does nothing is worse than one that isn't there.
  Two deliberate lines. **Reads aren't logged**: opening a report is a read (the view fetches on every mount, and logging that would bury the entries that matter under navigation noise), but *exporting* one is an event, because that's the moment case material leaves the console. And **a cache hit isn't a run**: calling triage twice records one entry, since the second served the cache and cost no model call.
  Two limits printed on the panel rather than left to be discovered: entries **cannot say who** — there's no sign-in, so attribution is the free-text officer the case names — and the log is **in memory like everything else**, so it covers the current session only. An audit log that overstates what it proves is worse than none.
  This was the last thing blocking three deferred features from being honest rather than estimated: dashboard trend deltas, "new since you last looked" on Alerts, and a report that states when a lead was confirmed. None of the three are wired up yet — the record now exists to build them on.
- **Alerts** (`Alerts` tab in a case) — eight deterministic rules over the evidence in `backend/alerts.py`, each one citable: known-hash image match, actor above the concern threshold, the same pattern against 3+ contacts, cross-channel identity resolution, repeated channel-migration asks, age probes, late-night concentration, and a voice call following a message (off the correlation engine, which scores the case's real message→call pair at 0.82). Recomputed per request rather than stored — the rules are cheap and a stored list would go stale against the evidence the moment anything was ingested. 13 fire on the current bundle: 5 critical, 7 high, 1 medium.
  Three things keep this from being decoration. **Every alert shows the rule that fired it** — "Why this fired" is on the card, not in a tooltip, because an alert an officer can't interrogate is one they learn to scroll past. **Actor-level rules only fire for actors already above the concern threshold**, so late-night activity or an age disclosure can never raise an alert *about a child* — the same gate the People tab uses, for the same reason. **There is no "3 new" badge**: nothing here records when an officer last looked, so an unread count could only be invented, exactly like the dashboard's absent trend deltas. What exists instead is explicit acknowledgement, stored per case and keyed by a stable `alert_id` so it survives recomputation — and acknowledging never hides anything, since alerts that vanish when ticked are how findings get lost.
- **Case report** (`Report` tab in a case) — the plan's automated case-report generation, assembled in `backend/report.py` from the ingested evidence and the officer's own rulings. Six sections: evidence summary (counts by type and channel, period covered, the flagged artifacts by ID), identity resolution (who resolved across more than one identifier or channel), persons of interest, findings, review position, and method + limitations. Every evidence ID in it opens on the Timeline. **Copy Markdown / Download .md** exports the same document — rendered backend-side, so the file and the screen come from one function and can't drift; the blob is built and revoked in the browser, so case material never leaves the machine.
  What makes it defensible rather than decorative: **only leads an officer confirmed become findings.** A rejected lead is excluded *and counted*; a lead nobody has ruled on is reported as outstanding, never quietly promoted — section 5 states the review position, so the document is honest about how much human review it rests on. With nothing confirmed it says so and states no findings rather than padding. **Opening a report never runs the agent** (`triage.get_cached`): a report is a record of what was reviewed, and a document that kicked off a fresh model run each time it opened would describe findings nobody had seen. **The limitations are data, not UI copy** — `report.method` is generated once and rendered verbatim in both the view and the Markdown, so the screen and the exported file can never state different caveats. They include the real ones: how many timestamps have an inferred timezone (384 of 736 on the current bundle), that flagging is exact SHA-256 with no pHash, that scoring is lexical rather than semantic, and that this build keeps no audit log.
  The concern threshold now lives in `signals.py` as `CONCERN_THRESHOLD` and is imported by rule-based triage and the report, because three consumers were asking the same question and a case where they disagreed about who is of concern would be indefensible.
- **Triage panel** — ranked leads with cited evidence chips, the model that produced them, how many evidence queries it ran, and what the citation guard dropped. Confirm / Reject / Flag in green / red / yellow.
- **Citation click-through** — clicking an evidence chip on a lead switches to the Timeline, opens that artifact in the Event Details panel and scrolls the spine to the source line (the row itself, not just its day header). The last beat of the plan's 90-second demo script. `focusArtifactId` is read once at mount rather than synced by an effect: switching views unmounts the timeline, so arriving from a citation is always a fresh mount — no prop-to-state sync, no cascading render. Switching tabs by hand clears the pending citation so returning to the Timeline later doesn't re-jump to a lead you've moved on from.
- **A dead case ID degrades instead of crashing.** All view data now loads through `lib/fetchJson.ts`, which throws on a non-`ok` response instead of handing a `{"detail": ...}` error body downstream to be `.forEach`'d as if it were an array. Verified by killing the backend mid-session: the case page shows its error state and the console carries only the expected 404s. `buildActorIndex` keeps a belt-and-braces `Array.isArray` guard — a colour lookup is the last thing that should be able to take a page down.
- Folder-drop ingest: drag-and-drop or click-to-browse a whole case folder (recursive, preserves the `images/` subpath).
- Timeline: 3-pane console — filters (participants/type/flagged/high-priority), spine list with sender→recipient rows and platform badges, Event Details panel (tags, notes, Linked Artifacts, click-through).
- Graph: D3-force, colour- and icon-per-node-type (person blue / phone green / group purple / handle indigo, classified server-side from identifier shape) so the graph reads at a glance instead of requiring every label to be read. Shape and colour deliberately encode the same thing — it stays legible at small sizes and for colour vision deficiency, where the icon still disambiguates. Flagged nodes keep their kind colour and carry a red flag badge instead, so "what this is" and "this is flagged" are separate channels — plus a legend, zoom/fit toolbar, edge interaction-counts, and a node detail panel (stats, recent interactions, related artifacts). Node size/color still driven by *channel span* (`degree`) rather than raw edge count — verified this distinction matters (the predator's node has an unremarkable 10 graph edges but a distinct `degree: 4`, since the kids' own identities correctly stay unmerged across platforms).

**Signals + triage (Day 3)**
- `signals.py` — the deterministic layer the plan calls for: phrase-level lexicons for isolation and channel-migration language, an `age_probe` lexicon that matches *asking* but never answering, plus escalation slope, asymmetry and late-night ratio as arithmetic over the timeline. Every aggregate carries the artifact IDs it was computed from.
- **Echo suppression** is the load-bearing detail: within a thread, whoever uses a signal first owns it, and later use by the other party is marked an echo and doesn't score. Without it a 12-year-old replying "okay i won't tell anyone" scores as running an isolation tactic. With it, victims drop off the risk list entirely — `swim_coach_rk` scores 1.0, every other actor ≤0.103, and the victims' residual is only the late-night contextual nudge.
- `triage.py` — a manual tool-use loop over five read-only tools: signal profiles, message thread, timeline slice, graph neighbourhood, single artifact. Deliberately not the SDK's beta `tool_runner` — owning the loop keeps the cache and fallback paths inspectable this close to the pitch.
- **Provider-swappable.** The same loop runs against Groq (`openai/gpt-oss-120b`, free tier, `reasoning_effort=medium`) or Anthropic (`claude-opus-5`, adaptive thinking, strict JSON out). Tools are defined once and translated to OpenAI function-calling shape, so the two providers can't drift. `ACPIA_LLM_PROVIDER=auto` picks whichever key is present, Groq first.
  This is worth a line in the pitch, not just the README: the Groq-served models are **open-weights**, so this exact loop can point at a self-hosted vLLM or Ollama endpoint inside a police network with evidence never leaving it. For child-protection casework that's a procurement question, not a preference. Be honest about the limit though — Groq's *hosted* API is still third-party cloud; what open weights buy is the *option* to go on-prem.
- **Citation guard** — every `evidence_id` is checked against the case's artifact store; a lead citing an unknown ID, or citing nothing, is dropped and the reason surfaced in the UI rather than swallowed.
- **Fallback ladder is real**: no API key, a network failure, a model refusal, or an agent run where nothing survives the guard all fall through to rule-based triage off the same signal profiles — cited identically. Results are cached per case, so the demo replays without touching the network.
- **Confirm / reject / flag** on every lead, persisted per case (`LeadDecision`), in traffic-light colour.

**Four things the Groq free tier forced, each found by hitting it:**
- `max_completion_tokens` counts against the tokens-per-minute cap *before generation* — asking for 16000 on an 8K/min model is an instant 413 regardless of prompt size. Budgets are sized for cumulative loop spend, not per-call.
- On gpt-oss, **reasoning tokens come out of the same completion budget as the answer.** At `reasoning_effort=high` the model spent all 1600 tokens reasoning and returned an *empty* message with `finish_reason="length"` — a silent failure that reads like a broken parser. Hence `medium`, a larger synthesis budget, and an explicit named error for that exact case.
- **Removing `tools` from a request does not force an answer** — Groq returns `400 tool_use_failed: "Tool choice is none, but model called a tool"`. Termination is instead a separate tool-free synthesis call, which structurally cannot call a tool.
- Prompting the model to "stop when you have enough" is unreliable; a thorough model asked to investigate keeps investigating. The round cap is what actually terminates it.

**Verified, not just built:** the full pipeline was run end-to-end against the real 736-artifact bundle repeatedly — `swim_coach_rk` resolves across exactly the 4 expected channels, correlation scores a real message→call pair at 0.82, and the graph visually surfaces the one degree-4 node.

Triage is verified live, not just wired: a case created and ingested over HTTP (736 artifacts, 3 flagged), a real agent run returning `source: agent · openai/gpt-oss-120b · 3 evidence queries · 0 dropped` with three cited leads, all five tools exercised, the citation guard confirmed to drop both a hallucinated `a_9999` citation and an uncited lead, and Confirm clicked in the browser and read back from the backend. Frontend typechecks clean; a fresh tab loads with a clean console.

### What's next

Two build days left (11–13 Aug; the 14th is travel and pitch only), so this is
ordered by what actually affects the pitch, not by when it was noticed.

**Before the pitch — directly touches what the room sees:**

1. **Lead quality is the open question, not plumbing, and it's the differentiator — the prompt pass is in, but it is UNVERIFIED against a live model.** The problem: on the first runs `gpt-oss-120b` read *one* victim's threads (Aisha) and wrote three leads about her, missing the case's headline finding — one operator running the same playbook against four minors across four channels — which the rule-based path states plainly. `SYSTEM_PROMPT` in `triage.py` now prescribes the tool order explicitly rather than leaving it to the model: round 1 is `get_signal_profiles` alone (it can't name the top actor before it has them); round 2 is `get_graph_neighbourhood` on that actor **plus** `get_message_thread` on two or three *different* counterparties **in the same turn** — establishing scope before reading any thread closely; round 3 is depth, on whatever the comparison made important. Two lead-shaping rules back it: one operator working several people is **one** lead that leads on the scope and cites artifacts from more than one relationship, and no two leads about the same actor unless the conduct genuinely differs. This fits the 3-round `GROQ_TOOL_ROUNDS` cap.
   **What's still owed:** nobody has run this against a model. There's no `GROQ_API_KEY` on the machine right now, so every path exercised since the change has been rule-based. Drop a key in, run it cold, and check the leads actually widened — that's the one thing on this list that changes what the AI triage moment demonstrates, and right now it's a plausible fix, not a confirmed one.
2. ~~Clicking a lead's evidence ID doesn't jump to the timeline.~~ **Done** — see "Citation click-through" above. Verified in the browser end to end: clicking `a_0045` on the top lead switched to the Timeline, scrolled ~30,000px down the spine, and centred the selected row — `swim_coach_rk → Aisha, "let's do a call instead of texting, more private"`, which is a good line to land on in front of a room.
3. ~~The frontend crashes rather than degrades when a case ID doesn't exist.~~ **Done** — see "A dead case ID degrades instead of crashing" above.
4. Rehearse the actual failure mode: kill the backend mid-demo once during practice and confirm auto-seed + the degrade path behave the way you'd want live. **Half-done:** the backend was killed mid-session and restarted — port 8000 released cleanly (no ghost socket that time), auto-seed re-ingested all 736 artifacts under a fresh `case_id`, and the stale tab degraded to the case page's error state rather than a blank screen. Still worth doing once at full demo pace, and note the honest wrinkle: with the backend *down*, a stale tab says "Case not found", which is the 404 copy rather than a connection error. Accurate enough to not embarrass anyone, misleading if you read it literally.

**After the pitch — real gaps, not currently blocking anything:**

- **Shared selection state** between Timeline and Graph (click a node → timeline scrolls to it; select a time range → graph filters to that window). Plan's stated end-of-Day-2 goal. Cheaper now than it was: item 2's `focusArtifactId` prop and the per-row `artifact-<id>` anchors are the same mechanism a graph node would use — the Graph view needs the matching `onSelectActor` wiring, and the case page already holds the state it would live in.
- Graph's **Filters sidebar** (date range, participants search, per-type Show checkboxes) and **mini-map** — present in the current reference design, not yet built.
- **pHash matching** — only exact SHA-256 hash flagging is wired up. The plan calls for SHA-256 *plus* pHash against a mock list.
- **Age-gap indicators** are still lexicon-only (`age_probe` catches the asking). The plan wanted real language understanding here; that now lives with the agent rather than in `signals.py`, so it's only as good as the agent run — see item 1.
- **Dashboard trend metrics** need an ingest-time audit log — see the Dashboard note above for why they're absent rather than estimated.
- **No auth / user model.** The sidebar has no signed-in officer because there's nobody to sign in; a case records its investigating officer as free text only. This is also what stops alert acknowledgement and lead decisions from recording *who* ruled — the state is real, the attribution isn't there to record.
- **The three features the audit log now unblocks**, none of them wired yet: dashboard trend deltas (see the Dashboard note for why they're absent rather than estimated), "new since you last looked" on Alerts, and a report section stating when each lead was confirmed. The record exists; reading from it is the remaining work. Note the honest catch — the log is in-memory and per-session, so a delta computed from it would only ever cover the current session until there's persistence.
- ~~Full-text search over the artifact store~~ and ~~automated case-report generation from confirmed leads~~ — both **done**; see "Evidence search" and "Case report" above.
- No automated tests — everything so far has been verified by hand (curl, browser interaction, direct Python inspection) each time something was built. Fine at this scale, worth a gut check if there's spare time.

**Ongoing, not a task:**

- Free-tier rate limits shape the design. gpt-oss-120b is 8K tokens/min, and the requested `max_completion_tokens` counts against that *before generation*, so budgets are deliberately small (`GROQ_MAX_TOKENS=1600`, tool results truncated to 3000 chars, 3 tool rounds then a synthesis call). A cold run takes 30–60s including one rate-limit sleep; it's cached afterwards, so **warm the demo case before the pitch and it replays instantly**. `llama-3.3-70b-versatile` has 12K TPM if you want more headroom.
- The Anthropic path is coded and ready but unusable on this machine: that key was revoked (it was leaked in a chat transcript, and had no credit anyway). A Claude Pro/Max subscription does **not** include API credits. `auto` prefers Groq regardless.

### Known quirks worth knowing

- This dev machine hit a Windows-specific issue where `uvicorn --reload` silently spawned its worker on the system Python instead of the venv (serving stale code with no error), and separately a killed process left a "ghost" listener on port 8000 that never released. **This recurs.** The signature is a port that answers `/health` but 404s on newer routes, with `netstat` naming a PID that `tasklist` says doesn't exist — an orphaned socket serving stale code. Don't fight it: run the backend on a free port and point the frontend at it with `frontend/.env.local` (`BACKEND_URL=http://localhost:8010`). That file is gitignored, so it never travels with the repo — but **delete or update it once port 8000 is clean**, or the frontend keeps proxying to a port nothing is listening on. **Also:** editing `.env.local` doesn't reliably reload into a already-running `next dev` — Next reads `process.env` once at module load and hasn't picked up a deletion in practice this session, only a write. If the proxy still 500s after fixing the port, write the file with the correct value (don't just delete it) and give it a few seconds; if it's still stuck, restart `next dev`. Sessions so far have used 8001 and 8010 this way.
- **This port issue is exactly what auto-seeding (above) protects the dashboard against.** The backend restart itself is often unavoidable on this machine; auto-seed just means it stops mattering when it happens.
- **Restarting the backend can make the *next* frontend request 500 once, even though the backend is healthy.** Hit while building the report: every FastAPI request logged 200, but the timeline showed "Failed to load timeline — HTTP 500". The cause is `next dev` holding keep-alive sockets to the process that just died — the first proxied request writes to a dead socket and Next surfaces `ECONNRESET` as a 500. Same family as the ghost-socket issue above, and harmless: reload and it's fine. Worth knowing so nobody debugs the backend for a connection-pool artifact — and worth not restarting the backend mid-demo for.
- Quiet-period collapsing in the Timeline (the "9 days · 41 events · no flags" summary row) is implemented and unit-tested correct, but never actually triggers on the current synthetic bundle — `browser_history.csv` alone guarantees every day has more than 3 events. Not a bug; would need the generator to leave a genuine quiet stretch to demo this feature.

## Layout

```
acpia/
  frontend/   Next.js 16 + TypeScript + Tailwind — the investigator console
    public/                   whatsapp.png, instagram.png (downscaled to 128px)
    src/app/                  routes: dashboard, cases list, new case, case detail, API proxies
    src/components/shell/     AppShell, Sidebar
    src/components/cases/     CaseHeader — breadcrumb, stat strip
    src/components/dashboard/ EvidenceDonut
    src/components/timeline/  filters sidebar, spine list, event detail panel
    src/components/graph/     D3-force entity graph
    src/components/persons/   persons of interest — signal profiles, cited
    src/components/search/    evidence search — query, filters, highlights
    src/components/alerts/    alert rules, severity, acknowledge/reopen
    src/components/audit/     audit log — spine, category filters
    src/components/settings/  runtime config inspector
    src/components/report/    case report — sections, Markdown export
    src/components/triage/    ranked leads, citations, confirm/reject/flag
    src/components/ui/        Card, ListRow, SegmentedControl, Button, StatusBadge,
                              PlatformBadge, ThemeToggle
    src/lib/                  types, timeline grouping/display, actor colors,
                              platform identity, folder-drop walking,
                              fetchJson (throws on non-ok, so a 404 body
                              never reaches a render path)
  backend/    FastAPI
    main.py         routes
    models.py        canonical Artifact schema + Case/ResolvedActor/annotation models
    store.py         in-memory per-case artifact store
    parsers.py        WhatsApp / Instagram / call log / browser history / image parsers
    identity.py        union-find identity resolution
    correlation.py      windowed proximity+modality scoring
    graph.py          networkx entity graph builder
    alerts.py          deterministic alert rules, severity, acknowledgement
    audit.py           append-only per-case event log
    settings.py        effective runtime config (never returns a secret)
    report.py          case report from confirmed leads + Markdown render
    search.py          full-text search, field weights, snippet highlights
    signals.py         grooming-signal lexicons + trajectory arithmetic
    triage.py          agent tool-use loop, citation guard, rule fallback
    stats.py           cross-case dashboard aggregates (no invented trends)
  data/       generate_case.py and the synthetic evidence bundle it produces
```

## Running locally

**Backend**
```bash
cd backend
python -m venv venv
./venv/Scripts/activate   # Windows
pip install -r requirements.txt
cp .env.example .env      # then paste a GROQ_API_KEY into it
uvicorn main:app --reload --port 8000
```

Get a free Groq key at <https://console.groq.com/keys>. `backend/.env` is gitignored
and read at startup; exported environment variables override it. Set `GROQ_API_KEY`
or `ANTHROPIC_API_KEY` — with both, Groq wins (`ACPIA_LLM_PROVIDER` pins the choice).
**Without any key the app still runs**; triage falls back to the deterministic
rule-based path, which is cited identically.

Before demoing, open the case once and let triage run — the result is cached per
case, so the pitch replays instantly and doesn't depend on the venue's network.
The demo case is auto-seeded on every backend start (see above) but gets a
**fresh case_id each time**, so the triage cache doesn't carry over across a
restart — re-run it after the *last* restart before you go on, not before an
earlier one.

**Frontend**
```bash
cd frontend
npm install
npm run dev
```

Frontend on `http://localhost:3000`, backend on `http://localhost:8000`. Next.js API routes proxy to the FastAPI service — see plan §1. Regenerate the synthetic bundle any time with `python data/generate_case.py`.
