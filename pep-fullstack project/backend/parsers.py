"""Five parsers, one canonical schema out. Everything upstream is a
parser; everything downstream reads Artifact (models.py) and nothing
else — see ACPIA_Plan.md section 1.

Timestamp handling is deliberately explicit about what we know vs. what
we're assuming:
  - Instagram / call log / browser history timestamps arrive with an
    explicit UTC offset -> tz_inferred=False, high confidence.
  - WhatsApp export timestamps have no timezone marker at all (true of
    real exports, not just ours) -> we assume IST, tz_inferred=True,
    confidence 0.7.
  - EXIF timestamps never carry timezone info and the camera clock is
    trivially user-settable -> assume IST, tz_inferred=True, but lower
    confidence (0.6) than chat timestamps.
This is what lets low-confidence times render dashed in the timeline
later, instead of asserting a false certainty.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import re
from datetime import datetime, timedelta, timezone

import imagehash
import piexif
from PIL import Image
from typing import NamedTuple

from models import Artifact, Entities, TimeInfo
from store import CaseStore


# Perceptual-hash threshold. 64-bit pHash: 0 is identical, 64 is opposite;
# 6 is the widely-used near-duplicate cutoff (recoloured / resized / mildly
# recompressed copies land in the low single digits). Exposed on the
# Settings page via backend/settings.py so the number an officer reads on
# an alert card is the same one that decided to raise it.
PHASH_MAX_DISTANCE = 6


class KnownHashes(NamedTuple):
    """Two lookups in one bag, so parsers can accept either kind of entry
    from `known_hashes.txt` and check against both without the caller
    threading a second argument through every call site."""

    sha256: set[str]
    phash: list[imagehash.ImageHash]

    @classmethod
    def empty(cls) -> "KnownHashes":
        return cls(set(), [])

    def merge(self, other: "KnownHashes") -> "KnownHashes":
        return KnownHashes(self.sha256 | other.sha256, [*self.phash, *other.phash])

IST_OFFSET = timedelta(hours=5, minutes=30)

PHONE_RE = re.compile(r"\+91\d{10}")
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")

WA_HEADER_RE = re.compile(
    r"^=== Chat: (?P<owner>[^&]+) & (?P<counterparty>[^(]+?)(?: \((?P<phone>\+\d+)\))? ===$"
)
WA_LINE_RE = re.compile(
    r"^(?P<date>\d{2}/\d{2}/\d{2}), (?P<time>\d{2}:\d{2}) - (?P<sender>[^:]+): (?P<text>.*)$"
)


def extract_phones(text: str) -> list[str]:
    return sorted(set(PHONE_RE.findall(text)))


def extract_emails(text: str) -> list[str]:
    return sorted(set(EMAIL_RE.findall(text)))


def _chunk_ref(artifact_id: str) -> str:
    return f"chunk_{artifact_id.removeprefix('a_')}"


def _naive_to_utc_iso(naive: datetime, assume_ist: bool) -> str:
    if assume_ist:
        naive = naive - IST_OFFSET
    return naive.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


def _aware_to_utc_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


# --------------------------------------------------------------------------
# WhatsApp
# --------------------------------------------------------------------------

def parse_whatsapp(text: str, source: str, store: CaseStore) -> int:
    owner: str | None = None
    counterparty: str | None = None
    counterparty_phone: str | None = None
    count = 0

    for line_no, raw_line in enumerate(text.splitlines(), start=1):
        header = WA_HEADER_RE.match(raw_line)
        if header:
            owner = header.group("owner").strip()
            counterparty = header.group("counterparty").strip()
            counterparty_phone = header.group("phone")
            continue

        line = WA_LINE_RE.match(raw_line)
        if not line or owner is None:
            continue

        sender = line.group("sender").strip()
        message_text = line.group("text")
        naive_dt = datetime.strptime(
            f"{line.group('date')} {line.group('time')}", "%d/%m/%y %H:%M"
        )

        counterparty_actor = counterparty_phone or counterparty
        actors = sorted({owner, counterparty_actor}) if counterparty_actor else [owner]

        # The stored "sender" must be a *resolvable* identifier (something
        # that appears in `actors`/`entities`), not the raw display name
        # from the chat line -- "RK Sir" never appears anywhere else in the
        # schema, only the underlying phone number does, so the frontend's
        # sender/recipient lookup would silently fail to resolve it.
        sender_actor = counterparty_actor if sender == counterparty else owner

        phones = set(extract_phones(message_text))
        if counterparty_phone:
            phones.add(counterparty_phone)

        artifact_id = store.next_artifact_id()
        artifact = Artifact(
            artifact_id=artifact_id,
            type="message",
            source=source,
            time=TimeInfo(
                value=_naive_to_utc_iso(naive_dt, assume_ist=True),
                kind="authored",
                source_field=f"{source}:line_{line_no}",
                tz_inferred=True,
                confidence=0.7,
            ),
            actors=actors,
            entities=Entities(phones=sorted(phones), emails=extract_emails(message_text)),
            content_ref=_chunk_ref(artifact_id),
        )
        store.add(artifact, {"sender": sender_actor, "sender_display": sender, "text": message_text})
        count += 1

    return count


# --------------------------------------------------------------------------
# Instagram DMs
# --------------------------------------------------------------------------

def parse_instagram(raw_json: str, source: str, store: CaseStore) -> int:
    data = json.loads(raw_json)
    count = 0

    for thread_idx, thread in enumerate(data.get("threads", [])):
        participants = sorted(set(thread.get("participants", [])))
        for msg_idx, msg in enumerate(thread.get("messages", [])):
            text = msg.get("text", "")
            ts = datetime.fromisoformat(msg["timestamp"])
            tz_inferred = ts.tzinfo is None
            if tz_inferred:
                ts = ts.replace(tzinfo=timezone.utc)

            artifact_id = store.next_artifact_id()
            artifact = Artifact(
                artifact_id=artifact_id,
                type="message",
                source=source,
                time=TimeInfo(
                    value=_aware_to_utc_iso(ts),
                    kind="authored",
                    source_field=f"{source}:thread_{thread_idx}:msg_{msg_idx}",
                    tz_inferred=tz_inferred,
                    confidence=0.6 if tz_inferred else 0.95,
                ),
                actors=participants,
                entities=Entities(
                    # Sender-only, deliberately -- not the full participant
                    # list. Identity resolution treats identifiers that
                    # co-occur in `entities` as one person; if this held
                    # both participants, the phone number the predator
                    # volunteers in a migration-ask message would wrongly
                    # merge the *kid's* handle into the predator's identity
                    # too. `actors` still lists both parties for filtering.
                    handles=[msg.get("sender")] if msg.get("sender") else [],
                    phones=extract_phones(text),
                    emails=extract_emails(text),
                ),
                content_ref=_chunk_ref(artifact_id),
            )
            store.add(artifact, {"sender": msg.get("sender"), "text": text})
            count += 1

    return count


# --------------------------------------------------------------------------
# Call log
# --------------------------------------------------------------------------

def parse_call_log(raw_csv: str, source: str, store: CaseStore) -> int:
    count = 0
    for row_idx, row in enumerate(csv.DictReader(io.StringIO(raw_csv)), start=2):
        ts = datetime.fromisoformat(row["timestamp"])
        tz_inferred = ts.tzinfo is None
        if tz_inferred:
            ts = ts.replace(tzinfo=timezone.utc)

        phones = sorted({row["from"], row["to"]})
        artifact_id = store.next_artifact_id()
        artifact = Artifact(
            artifact_id=artifact_id,
            type="call",
            source=source,
            time=TimeInfo(
                value=_aware_to_utc_iso(ts),
                kind="logged",
                source_field=f"{source}:line_{row_idx}",
                tz_inferred=tz_inferred,
                confidence=0.6 if tz_inferred else 0.95,
            ),
            actors=phones,
            entities=Entities(phones=phones),
            content_ref=_chunk_ref(artifact_id),
        )
        store.add(
            artifact,
            {"from": row["from"], "to": row["to"], "duration_seconds": int(row["duration_seconds"])},
        )
        count += 1

    return count


# --------------------------------------------------------------------------
# Browser history
# --------------------------------------------------------------------------

def parse_browser_history(raw_csv: str, source: str, store: CaseStore) -> int:
    count = 0
    for row_idx, row in enumerate(csv.DictReader(io.StringIO(raw_csv)), start=2):
        ts = datetime.fromisoformat(row["timestamp"])
        tz_inferred = ts.tzinfo is None
        if tz_inferred:
            ts = ts.replace(tzinfo=timezone.utc)

        artifact_id = store.next_artifact_id()
        artifact = Artifact(
            artifact_id=artifact_id,
            type="browser_history",
            source=source,
            time=TimeInfo(
                value=_aware_to_utc_iso(ts),
                kind="logged",
                source_field=f"{source}:line_{row_idx}",
                tz_inferred=tz_inferred,
                confidence=0.55 if tz_inferred else 0.9,
            ),
            actors=[row["device_owner"]],
            entities=Entities(),
            content_ref=_chunk_ref(artifact_id),
        )
        store.add(
            artifact,
            {"device_owner": row["device_owner"], "url": row["url"], "title": row["title"]},
        )
        count += 1

    return count


# --------------------------------------------------------------------------
# Known-hash list
# --------------------------------------------------------------------------

def parse_known_hashes(raw_text: str) -> KnownHashes:
    """Parse a mixed known-hash list.

    Line formats accepted:
      - `sha256:<hex>`  — byte-identical match
      - `phash:<hex>`   — perceptual-hash match (Hamming distance)
      - `<hex>`         — bare hex, treated as sha256 (back-compat with
                          existing bundles predating the split)

    Trailing `# comment` and blank lines are ignored. Malformed entries
    are skipped rather than raising — a bad line on the known list must
    not prevent the good entries from being loaded.
    """
    sha256: set[str] = set()
    phash: list[imagehash.ImageHash] = []

    for line in raw_text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        token = line.split()[0].lower()

        if token.startswith("sha256:"):
            sha256.add(token[len("sha256:"):])
        elif token.startswith("phash:"):
            try:
                phash.append(imagehash.hex_to_hash(token[len("phash:"):]))
            except ValueError:
                continue
        else:
            sha256.add(token)  # bare hex — legacy shape

    return KnownHashes(sha256, phash)


# --------------------------------------------------------------------------
# Images — SHA-256 against the known-hash list, plus whatever EXIF gives
# us. We never persist raw image bytes into the store (nor serve them to
# the frontend): "the officer sees a flag, never the file."
# --------------------------------------------------------------------------

def parse_image(content: bytes, source: str, known: KnownHashes, store: CaseStore) -> None:
    digest = hashlib.sha256(content).hexdigest()
    flags: list[str] = []
    if digest in known.sha256:
        flags.append("hash_match:sha256")

    # Perceptual-hash pass. Independent of the SHA-256 result: an artifact
    # can be both a byte-identical match and a perceptual match against
    # different reference entries. The alert layer dedupes for
    # presentation; the artifact carries the full truth.
    phash_value: str | None = None
    phash_distance: int | None = None
    if known.phash:
        try:
            with Image.open(io.BytesIO(content)) as img:
                ph = imagehash.phash(img)
            phash_value = str(ph)
            # ImageHash.__sub__ returns numpy.int64 (the underlying hash is
            # a numpy bool array), not a native int. Pydantic's serializer
            # doesn't know that type and raises on it -- and because this
            # value lands in the shared per-case content dict, one poisoned
            # image artifact breaks GET /content for the whole case, which
            # is what every other view (Timeline, Search, Graph, citation
            # click-through) reads artifact previews from. Cast at the
            # point of computation so nothing downstream can be surprised
            # by it -- confirmed by reproducing the HTTP 500 live (traced
            # to PydanticSerializationError: numpy.int64) and rerunning
            # after this fix.
            phash_distance = int(min(ph - ref for ref in known.phash))
            if phash_distance <= PHASH_MAX_DISTANCE:
                flags.append(f"hash_match:phash:{phash_distance}")
        except Exception:
            pass  # unreadable image: fall through — the artifact still records what we know

    captured_at: datetime | None = None
    exif_artist: str | None = None
    try:
        exif_dict = piexif.load(content)
        dt_bytes = exif_dict.get("Exif", {}).get(piexif.ExifIFD.DateTimeOriginal)
        if dt_bytes:
            captured_at = datetime.strptime(dt_bytes.decode(), "%Y:%m:%d %H:%M:%S")
        artist_bytes = exif_dict.get("0th", {}).get(piexif.ImageIFD.Artist)
        if artist_bytes:
            exif_artist = artist_bytes.decode("utf-8", errors="ignore")
    except Exception:
        pass  # missing/corrupt EXIF -- fall through, artifact still gets a (low-confidence) time

    phones = extract_phones(exif_artist) if exif_artist else []

    if captured_at is not None:
        time_value = _naive_to_utc_iso(captured_at, assume_ist=True)
        confidence = 0.6
    else:
        time_value = "1970-01-01T00:00:00Z"
        confidence = 0.2

    artifact_id = store.next_artifact_id()
    artifact = Artifact(
        artifact_id=artifact_id,
        type="image",
        source=source,
        time=TimeInfo(
            value=time_value,
            kind="captured",
            source_field=f"{source}:exif",
            tz_inferred=True,
            confidence=confidence,
        ),
        actors=phones,
        entities=Entities(phones=phones),
        content_ref=_chunk_ref(artifact_id),
        flags=flags,
    )
    store.add(
        artifact,
        {
            "filename": source,
            "sha256": digest,
            "phash": phash_value,
            "phash_distance": phash_distance,
            "exif_artist": exif_artist,
        },
    )
