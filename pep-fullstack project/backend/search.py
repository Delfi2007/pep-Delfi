"""Full-text search over the artifact store.

The plan lists this as a cheap win, and the reason it's worth doing
properly rather than as a client-side `.filter()` is the same reason the
case list says what it searches: a search box that quietly searches less
than it implies is worse than one that states its scope. So this searches
*every* text-bearing field the parsers produce — message bodies, page
titles and URLs, image filenames and EXIF artist, call participants — and
the response says which field each hit came from.

Three deliberate choices:

1. **Substring matching, not stemming.** "swim" finds "swim_coach_rk".
   An investigator typing a fragment of a handle or a phone number
   expects it to hit; a stemmer would help with English prose and hurt
   with identifiers, and identifiers are most of what gets searched here.

2. **All terms must match, but not necessarily in the same field.** A
   query of `aisha call` finds a message from Aisha about calling. Quoted
   `"more private"` is one term and must appear contiguously.

3. **Score is purely lexical — flagged items are not boosted.** It's
   tempting to float hash-flagged artifacts to the top, but then the
   ranking silently encodes a judgement and a search for an unrelated
   word returns the flagged images anyway. Flagging is a *filter* here,
   which the caller controls, not a thumb on the relevance scale.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from models import Artifact

# Field weights. Message text is what an investigator is nearly always
# looking for; a name matching inside a URL is a weaker hit than the same
# name in a sentence someone wrote.
FIELD_WEIGHTS: dict[str, float] = {
    "text": 3.0,
    "title": 2.0,
    "filename": 2.0,
    "url": 1.5,
    "sender": 1.0,
    "from": 1.0,
    "to": 1.0,
    "exif_artist": 1.0,
    "sha256": 1.0,
    "device_owner": 0.5,
}

# Human-readable names for the field a hit came from, so the UI can say
# "matched in page title" rather than leaking the payload key.
FIELD_LABELS: dict[str, str] = {
    "text": "Message",
    "title": "Page title",
    "url": "URL",
    "filename": "Filename",
    "sender": "Sender",
    "from": "Caller",
    "to": "Callee",
    "exif_artist": "EXIF artist",
    "sha256": "SHA-256",
    "device_owner": "Device owner",
}

# Characters either side of the match in the returned snippet. Enough to
# read the phrase in context on one line of a result row.
SNIPPET_PAD = 70

MAX_RESULTS = 100


@dataclass
class SearchHit:
    artifact: Artifact
    score: float
    field: str
    snippet: str
    # Ranges are relative to `snippet`, not to the source field, so the UI
    # can highlight without re-running the match and risking a mismatch
    # between what was scored and what is shown.
    highlights: list[tuple[int, int]]

    def to_dict(self) -> dict[str, Any]:
        return {
            "artifact_id": self.artifact.artifact_id,
            "type": self.artifact.type,
            "source": self.artifact.source,
            "time": self.artifact.time.value,
            "tz_inferred": self.artifact.time.tz_inferred,
            "actors": self.artifact.actors,
            "flags": self.artifact.flags,
            "field": self.field,
            "field_label": FIELD_LABELS.get(self.field, self.field),
            "snippet": self.snippet,
            "highlights": [list(h) for h in self.highlights],
            "score": round(self.score, 3),
        }


def parse_query(raw: str) -> list[str]:
    """Split a query into terms. Double-quoted runs stay whole, so
    `"more private"` is a phrase and not two common words."""
    terms: list[str] = []
    for quoted, bare in re.findall(r'"([^"]+)"|(\S+)', raw or ""):
        term = (quoted or bare).strip().lower()
        if term:
            terms.append(term)
    return terms


def _searchable_fields(artifact: Artifact, payload: dict[str, Any]) -> list[tuple[str, str]]:
    """(field name, text) pairs for one artifact, in weight order.

    Driven by what's actually in the payload rather than by artifact type:
    the parsers each write their own shape, and a type-switch here would
    need editing every time one of them gains a field.
    """
    fields: list[tuple[str, str]] = []
    for key, value in payload.items():
        if key not in FIELD_WEIGHTS or value in (None, ""):
            continue
        fields.append((key, str(value)))
    fields.sort(key=lambda f: FIELD_WEIGHTS.get(f[0], 0), reverse=True)
    return fields


def _find_all(haystack_lower: str, needle: str) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    start = haystack_lower.find(needle)
    while start != -1:
        spans.append((start, start + len(needle)))
        start = haystack_lower.find(needle, start + 1)
    return spans


def _snippet(text: str, spans: list[tuple[int, int]]) -> tuple[str, list[tuple[int, int]]]:
    """A window around the first match, with the highlight ranges rebased
    onto that window."""
    if not spans:
        return text[: SNIPPET_PAD * 2], []

    first = min(spans, key=lambda s: s[0])
    start = max(0, first[0] - SNIPPET_PAD)
    end = min(len(text), first[1] + SNIPPET_PAD)

    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(text) else ""
    window = text[start:end]

    offset = len(prefix) - start
    rebased = [
        (s + offset, e + offset)
        for s, e in spans
        if s >= start and e <= end
    ]
    return f"{prefix}{window}{suffix}", rebased


def search_artifacts(
    artifacts: list[Artifact],
    content: dict[str, Any],
    query: str,
    types: set[str] | None = None,
    flagged_only: bool = False,
    limit: int = 50,
) -> dict[str, Any]:
    """Rank artifacts against a query. Returns a JSON-ready payload."""
    terms = parse_query(query)
    if not terms:
        return {"query": query, "terms": [], "total": 0, "truncated": False, "results": []}

    hits: list[SearchHit] = []

    for artifact in artifacts:
        if types and artifact.type not in types:
            continue
        if flagged_only and not artifact.flags:
            continue

        payload = content.get(artifact.content_ref) or {}
        fields = _searchable_fields(artifact, payload)
        if not fields:
            continue

        score = 0.0
        matched_terms: set[str] = set()
        # The field that will carry the snippet: the highest-weighted one
        # that actually matched, so a hit shows the sentence rather than
        # the sender name that happened to match too.
        best_field: tuple[str, str, list[tuple[int, int]], float] | None = None

        for field, text in fields:
            lowered = text.lower()
            weight = FIELD_WEIGHTS.get(field, 0.5)
            field_spans: list[tuple[int, int]] = []

            for term in terms:
                spans = _find_all(lowered, term)
                if not spans:
                    continue
                matched_terms.add(term)
                field_spans.extend(spans)
                # Occurrences count, but with diminishing weight: a page
                # title repeating a word twice isn't twice as relevant.
                score += weight * (1 + 0.25 * (len(spans) - 1))

            if field_spans:
                field_score = weight * len(field_spans)
                if best_field is None or field_score > best_field[3]:
                    best_field = (field, text, sorted(field_spans), field_score)

        # AND semantics: every term has to land somewhere on this artifact.
        if len(matched_terms) < len(terms) or best_field is None:
            continue

        field, text, spans, _ = best_field
        snippet, highlights = _snippet(text, spans)
        hits.append(
            SearchHit(
                artifact=artifact,
                score=score,
                field=field,
                snippet=snippet,
                highlights=highlights,
            )
        )

    # Relevance first, then newest — two artifacts that match equally well
    # are most usefully ordered by recency. Two passes relying on sort
    # stability, since the keys sort in opposite directions and a score
    # can't be negated alongside an ISO timestamp string.
    hits.sort(key=lambda h: h.artifact.time.value, reverse=True)
    hits.sort(key=lambda h: h.score, reverse=True)

    capped = min(max(limit, 1), MAX_RESULTS)
    return {
        "query": query,
        "terms": terms,
        "total": len(hits),
        # Say so rather than silently returning the first page: "217
        # matches, showing 50" is information; 50 results presented as all
        # of them is a lie the UI would be telling.
        "truncated": len(hits) > capped,
        "results": [h.to_dict() for h in hits[:capped]],
    }
