# Build Prompt — Timeline Redesign: Multi-lane horizontal timeline + semantic analysis (ACPIA)

Paste this to the coding agent working inside the ACPIA repo. It has full context of the codebase
(FastAPI `backend/`, Next.js `frontend/`, `signals.py` with echo suppression + grooming lexicons,
`relevance.py` for AI relevance classification, existing Timeline view in
`src/components/timeline/`).

---

## The problem with the current timeline

The current timeline is a **vertical chat log** — one long scrollable list of every message in
chronological order. This breaks at scale:

- **6 months of messages = infinite scroll.** An officer cannot scroll through thousands of messages
  to find what matters.
- **1000 participants in the filter sidebar is unusable.** No human scans a checkbox list that long.
- **No structure.** The officer sees individual messages but never the *shape* — when did contact
  accelerate? Where did the tone change? What stage is this relationship at? Those answers are
  invisible in a flat list.
- **No cross-participant comparison.** If the suspect talks to 4 minors, the officer has to mentally
  reconstruct each thread from interleaved messages. The pattern — one operator running the same
  playbook on multiple targets — is the case's headline finding, and the current view buries it.

## What to build

Replace the current vertical timeline with a **two-mode timeline**:

1. **Multi-lane horizontal timeline** (default) — participants as columns, time on the vertical
   axis, messages as cards placed in their participant's lane at the correct time position. Select
   participants to compare side by side. Scroll sideways through participants, scroll vertically
   through time.
2. **Semantic analysis mode** (toggle) — same layout but time is grouped into **grooming stages**
   (trust-building, isolation, channel migration, escalation, contact request) instead of
   calendar dates. Each stage block shows the relevant messages + a right-hand summary explaining
   *why* that period is classified as that stage, citing the evidence.

Both modes respect the **AI relevance filter**: only relevant messages are shown by default, with
a toggle to reveal everything.

---

## Part 1: Participant bar (top of the timeline)

**The problem:** with many participants, a sidebar of checkboxes is unusable.

**The solution:** a horizontal bar at the top of the timeline, split into two tiers:

### Relevant participants (shown by default)
- Only participants who have **case-relevant messages** (from `relevance.py`) OR who are flagged as
  **persons of interest** (from `signals.py`, above the concern threshold).
- **Ranked** from highest concern score to lowest — the suspect appears first, then other persons of
  interest, then participants who have relevant messages but aren't persons of interest.
- Each participant chip shows: name/handle, message count (relevant / total), a concern-score bar
  or dot colour (red = high, amber = medium, blue = low/no concern), and platform icons for which
  channels they appear on.
- Clicking a participant chip **selects them as a lane** in the horizontal timeline below. Multiple
  chips can be selected — each adds a column. Click again to deselect.
- By default, the top 2–3 participants (suspect + primary victim) are pre-selected so the view
  isn't empty on load.

### Irrelevant participants (hidden by default)
- A collapsible section below the relevant bar: **"Show N other participants"** — expands to reveal
  the rest, greyed out, each with their message count. These can also be selected as lanes.
- A search box filters both tiers by name/handle.

### Participant count in the bar header
- **"12 relevant of 50 participants"** — always visible, so the officer knows the scope.

---

## Part 2: Multi-lane horizontal timeline (default mode)

### Layout

```
TIME AXIS (vertical, left edge)
│
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  │ Participant A│  │Participant B│  │Participant C│   ← selected lanes
│  └─────────────┘  └─────────────┘  └─────────────┘
│
├─ Day 1 ────────────────────────────────────────────
│  │ [msg] [logo] │  │             │  │ [msg] [logo]│
│  │              │  │             │  │             │
├─ Day 2 ────────────────────────────────────────────
│  │ [msg] [insta]│  │ [msg]  [○]  │  │             │
│  │              │  │             │  │             │
│  │              │  │ [msg] [logo]│  │             │
│  ...
│
│  ◄──── scroll sideways if >3-4 lanes ────►
```

### How it works

- **Vertical axis = time.** Day headers (or hour headers when zoomed in) run down the left edge.
  Messages sit at their correct time position within their participant's column.
- **Each selected participant = one column/lane.** Their messages appear as cards in their lane,
  aligned to the time axis. If participant A sent a message at 10:00 and participant B sent one at
  10:05, both cards sit at roughly the same vertical position — so the officer sees simultaneous /
  near-simultaneous activity across participants at a glance.
- **Horizontal scroll** when more than 3–4 participants are selected — lanes scroll sideways, time
  axis stays pinned on the left.
- **Message cards** show: sender→recipient, message text (truncated to 2 lines), platform badge
  (WhatsApp / Instagram / Call / Browser / Image), artifact ID, and a flag/alert icon if flagged or
  if an alert rule fired on it. Media messages (image/video/audio) show a media-type icon + thumbnail
  if available, plus a play/preview button.
- **Card colours/marks:**
  - Normal relevant message: default card style.
  - Flagged (hash-match or alert): red left border + flag icon.
  - Recovered (from `recovery.py`): dashed border + "recovered" badge + confidence %.
  - Deleted/unrecoverable: ghost card (faded, dashed outline), showing the gap.
  - AI-classified irrelevant (only visible when "show all" is on): greyed out, with the stated
    reason as a tooltip.
- **Click a card** → opens the existing **Event Details** panel on the right (tags, notes, linked
  artifacts, platform details) — reuse the current detail panel, don't rebuild it.
- **Zoom levels:** the officer can zoom in/out on the time axis:
  - **Month view** (6 months visible): each day is a thin row, message cards are dots/pips —
    the officer sees *density* and *gaps* rather than content. Good for spotting quiet periods,
    bursts, and the overall shape of communication.
  - **Week view** (default): day headers, message cards show truncated text.
  - **Day view** (zoomed in): hour headers, full message cards, all detail visible.
  - Zoom control: buttons or scroll-wheel on the time axis.
- **Mini-map / overview strip** at the bottom: a thin horizontal bar showing the full 6-month span
  as a density heatmap (darker = more messages). A draggable viewport rectangle shows where the
  current view is within the full span. Click anywhere on the strip to jump to that period. This
  solves "where am I in 6 months of data" at a glance.
- **Connecting lines (optional, toggle):** when the same conversation thread spans two lanes
  (suspect sends on WhatsApp, victim replies on Instagram), draw a thin line between the cards to
  show the cross-platform thread. This makes the channel-migration story visual.

### What this solves
- **No more infinite scroll.** The officer zooms to the month that matters, selects the participants
  that matter, and sees only their interactions side by side.
- **Cross-participant patterns are visible.** Select the suspect + 3 victims: three lanes, same time
  axis — the "one playbook, four targets" pattern jumps off the screen.
- **Gaps and bursts are visible.** A quiet period = empty vertical space. A burst = a cluster of
  cards. Deleted messages = ghost cards in the gap.

---

## Part 3: Semantic analysis mode (toggle)

A toggle at the top of the timeline: **"Chronological / Semantic analysis"**

When switched to semantic mode, the vertical axis changes from **calendar time** to
**grooming stages**. This is the second sketch — the "trust build up" view.

### Grooming stages (from `signals.py` lexicons + trajectory analysis)

Map the relationship onto recognized stages. Use the signals and lexicons already in `signals.py`:

| Stage | What it means | Signal source |
|-------|--------------|---------------|
| Contact | Initial contact, introduction | First message between the two actors |
| Trust-building | Friendly, supportive, "you can tell me anything" | Trust/rapport lexicon (buildable from existing signals) |
| Isolation | "Don't tell anyone", "this is our secret" | `isolation_language` lexicon in `signals.py` |
| Channel migration | "Let's move to WhatsApp", "text me here instead" | `channel_migration` lexicon in `signals.py` |
| Escalation | Age probes, boundary testing, explicit | `age_probe` lexicon, escalation slope in `signals.py` |
| Contact request | "Let's meet", "call me", actual calls | `late_night_ratio`, call correlation in `correlation.py` |

### Layout in semantic mode

```
STAGE AXIS          PARTICIPANT LANES                    SUMMARY
(vertical)          (messages in that stage)             (right panel)
│
├─ Contact ─────────────────────────────────────────    ┌──────────────┐
│  Month 1, Day 1-5  │ [msg1] [wa] │ [msg2] [ig] │    │ Initial      │
│                     │             │             │    │ contact via  │
│                     │             │             │    │ Instagram DM │
│                     │             │             │    │ 3 messages   │
│                     │             │             │    │ Cited: a_001 │
│                     │             │             │    │        a_002 │
│                     │             │             │    └──────────────┘
│
├─ Trust-building ──────────────────────────────────    ┌──────────────┐
│  Month 1-2         │ [msg] [msg] │ [msg]  [msg] │    │ 42 messages  │
│  (32 days)         │ [msg] [msg] │ [msg]        │    │ over 32 days │
│                    │  ▼ expand   │  ▼ expand    │    │ Supportive   │
│                    │             │              │    │ language,    │
│                    │             │              │    │ compliments, │
│                    │             │              │    │ "you're so   │
│                    │             │              │    │ mature"      │
│                    │             │              │    │              │
│                    │             │              │    │ WHY: 87% of  │
│                    │             │              │    │ messages use │
│                    │             │              │    │ rapport      │
│                    │             │              │    │ language     │
│                    │             │              │    │ Cited: a_045 │
│                    │             │              │    │   ... +38    │
│                    │             │              │    └──────────────┘
│
├─ Isolation ───────────────────────────────────────    ┌──────────────┐
│  Month 3           │ ⚠ [msg]    │              │    │ "don't tell  │
│                    │   [msg]    │ [msg]         │    │ your mom"    │
│                    │            │              │    │ 6 messages   │
│                    │            │              │    │ with isolat- │
│                    │            │              │    │ ion language  │
│                    │            │              │    │ Cited: a_201 │
│                    │            │              │    └──────────────┘
│  ... more stages
```

### How semantic mode works

- **Stage blocks replace day headers.** Each block represents a grooming stage, with its date range
  and duration shown. Within a block, messages are still in chronological order.
- **Only relevant messages for that stage** are shown. If a stage has 200 messages but only 15 carry
  the stage's signal, show those 15 by default, with an **"expand: show all N messages in this
  period"** toggle per block to see everything (including irrelevant chatter that happened during
  that time).
- **Summary panel on the right** — one summary card per stage block:
  - What stage this is and its definition.
  - **Why this period is classified as this stage**: which signals fired, what % of messages matched,
    the key phrases detected. Cited with artifact IDs — click to jump to the message.
  - Duration, message count, participants active in this stage.
  - Escalation indicator: arrow showing the *trajectory* from previous stage (→ or ↗ or ↑) so the
    acceleration is visible.
  - **AI-generated plain-language summary** of what happened in this stage (or rule-based summary
    when no API key), citing specific messages. Example: *"Over 32 days, swim_coach_rk sent 42
    messages building rapport — compliments, questions about school, 'you can tell me anything.'
    Aisha's replies increased from 1/day to 3/day. (a_045, a_067, a_089, ... +38)"*
- **Stage progression bar** at the top: a horizontal track showing all stages left-to-right, with
  the current relationship's progress marked (like the grooming trajectory from the earlier feature
  idea). Click any stage on the bar to jump to that block.
- **Multi-participant comparison in semantic mode:** if 2+ participants are selected, their messages
  appear in parallel lanes *within each stage block* — so the officer can see "the suspect used the
  same isolation language on Aisha in month 3 and on Meera in month 4" side by side. This is
  where the "one playbook, four targets" finding becomes impossible to miss.

### Backend support for semantic mode

- **`backend/stages.py`** (new): given a pair of actors and the case's artifacts, classify each
  message into a grooming stage using the existing `signals.py` lexicons + the timeline trajectory.
  Returns `[{stage, start_date, end_date, artifact_ids[], signal_matches[], summary}]`.
  Deterministic (lexicon-based); the AI path adds a richer summary but the stage classification
  itself is arithmetic over signals, not model-dependent.
- **`backend/main.py`**: `GET /cases/{id}/stages?actor1=X&actor2=Y` returns the stage breakdown for
  a relationship. `GET /cases/{id}/stages/summary?actor1=X&actor2=Y&stage=isolation` returns the
  AI/rule-based summary for one stage block.

---

## Part 4: Media handling

Messages aren't just text. The timeline must handle mixed media types cleanly:

- **Text messages**: show truncated text in the card (2 lines), full text in the detail panel.
- **Images**: show a small thumbnail in the card (40×40px), flagged images get a red border.
  Click → detail panel shows larger preview + EXIF metadata + hash status.
- **Audio messages**: show a waveform icon + duration in the card. Click → detail panel with
  playback controls. (For the demo, audio is synthetic metadata — no real playback needed; show
  the duration and the transcript if available.)
- **Video**: show a video icon + duration + thumbnail if available. Same detail-panel pattern.
- **Calls**: show a phone icon + duration + direction (incoming/outgoing) in the card. Calls connect
  across lanes with a line if both participants are visible.
- **Browser history**: show a globe icon + page title (truncated). Lower visual priority than
  direct messages.
- **Media filter**: a toggle row above the lanes — "All / Text / Images / Audio / Video / Calls" —
  so the officer can isolate, say, just the images to check for flagged content, or just the calls
  to see the contact-request pattern.

---

## Interaction summary

| Action | Result |
|--------|--------|
| Click participant chip | Toggle that participant as a lane |
| Click message card | Open Event Details panel (existing) |
| Scroll vertically | Move through time |
| Scroll horizontally | Move through participant lanes |
| Zoom in/out (time axis) | Month ↔ Week ↔ Day granularity |
| Click mini-map | Jump to that period |
| Toggle Chronological/Semantic | Switch between calendar time and grooming stages |
| Toggle "show all messages" | Reveal AI-hidden irrelevant messages (greyed) |
| Toggle "show other participants" | Reveal irrelevant participants (greyed) |
| Media filter buttons | Filter by message type |
| Click stage bar segment | Jump to that grooming stage (semantic mode) |
| Expand stage block | Show all messages in that period, not just signal matches |

---

## Acceptance criteria (verify, don't just build)

- With 5 participants selected, their messages align correctly on the shared time axis — a message
  at 10:00 in lane A sits at the same vertical position as a 10:05 message in lane B.
- The participant bar ranks by concern score, shows relevant count vs total, and the "show other
  participants" toggle works.
- Zoom levels (month/week/day) render correctly: month view shows density dots, week view shows
  truncated cards, day view shows full cards.
- The mini-map accurately reflects message density and the viewport position; clicking it jumps
  correctly.
- Semantic mode groups messages into the correct stages (test against the synthetic bundle where
  stage classification is known); stage summaries cite real artifact IDs; the citation guard drops
  uncited summaries.
- Recovered messages show as dashed-border cards with provenance; deleted/unrecoverable show as
  ghost cards; flagged messages show red border + flag.
- Selecting the suspect + 2 victims in semantic mode shows the parallel-playbook pattern visually.
- Click-through from any card opens the correct Event Details panel.
- Frontend typechecks clean; no horizontal overflow bugs when 1 or 10 lanes are selected.

## One-line pitch this enables

*"Select the suspect and three children. The timeline shows every conversation side by side on the
same clock — and in semantic mode, it maps each relationship onto the stages of grooming, with a
cited summary of why. The officer sees the pattern in seconds: one playbook, four targets, at
different stages of escalation."*
