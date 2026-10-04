"""Synthetic evidence bundle generator for ACPIA.

Produces a fictional case (no real people, no real content) that exercises
every downstream feature in ACPIA_Plan.md: cross-channel identity
resolution, timestamp-confidence handling, activity clustering, hash
flagging, and grooming-pattern signal features (isolation language,
channel-migration requests, escalation timing) — all through *behavioral
metadata and manipulation-tactic language*, never sexual or graphic
content. This mirrors the level of detail used in public child-safety
prevention education (e.g. "grooming stages" explainers), not real
incident transcripts.

Deterministic: same seed -> byte-identical bundle, so `case_manifest.json`
(the ground truth used to validate the correlation/triage engine later)
stays valid across regenerations.

Usage:
    python generate_case.py [--out DIR] [--seed N]
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance
import piexif

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

DEFAULT_SEED = 42
CASE_START = datetime(2025, 10, 20, 6, 0, 0, tzinfo=timezone.utc)

SCRIPT_DIR = Path(__file__).parent


# --------------------------------------------------------------------------
# Cast — entirely fictional. No real names, numbers, or handles.
# --------------------------------------------------------------------------

PREDATOR = {
    "phone": "+919742218890",
    "ig_handle": "swim_coach_rk",
    "ig_display_name": "R. Kumar | Swim Coach",
    # The WhatsApp contact name varies per victim's phone — same underlying
    # number, different saved label. This is the "different display name"
    # the demo script calls out.
    "wa_aliases": ["Coach RK", "Swim Coach", "RK Sir"],
}

# The four accounts the predator contacts (matches the demo's "4 accounts
# stating ages 11-13"). `whatsapp` / `instagram` flags which channels each
# child appears on — Aisha and Neha appear on both (the "2 handles
# overlapping with WhatsApp" the data spec calls for), Kiran is WhatsApp
# only, Meera is Instagram only.
KIDS = [
    {"name": "Aisha", "age": 11, "phone": "+919742210001", "ig_handle": "aisha_art11", "whatsapp": True, "instagram": True},
    {"name": "Neha", "age": 12, "phone": "+919742210002", "ig_handle": "hoopstar_neha12", "whatsapp": True, "instagram": True},
    {"name": "Kiran", "age": 13, "phone": "+919742210003", "ig_handle": None, "whatsapp": True, "instagram": False},
    {"name": "Meera", "age": 11, "phone": "+919742210004", "ig_handle": "meera_dance11", "whatsapp": False, "instagram": True},
]

# Background conversations: ordinary family/friend chatter, no predator
# involvement. These pad out realistic volume and give the false-positive
# contrast the triage engine needs to demonstrate it isn't just flagging
# "any conversation with a kid."
BACKGROUND_CONTACTS = [
    {"name": "Mom", "phone": "+919742299001", "count": 50},
    {"name": "Priya (BFF)", "phone": "+919742299002", "count": 55},
    {"name": "Class 7B Group", "phone": None, "members": ["Aisha", "Kiran", "Rohan", "Devika"], "count": 40},
]

WHATSAPP_TARGET_COUNTS = {"Aisha": 70, "Neha": 65, "Kiran": 60}
INSTAGRAM_TARGET_COUNTS = {"Aisha": 30, "Neha": 32, "Meera": 28}
CALL_TARGET_COUNTS = {"Aisha": 8, "Neha": 7, "Kiran": 6, "Meera": 5}
CALL_ESCALATION_DAY = 9  # calls only start after this day offset, per kid thread
THREAD_SPAN_DAYS = 21


# --------------------------------------------------------------------------
# Message lexicon — manipulation-tactic language only. No sexual or
# physically descriptive content, matching how grooming stages are
# described in public prevention-education material.
# --------------------------------------------------------------------------

STAGE_TEMPLATES = {
    "rapport": [
        "hii! thanks for the follow \U0001F60A",
        "haha you're funny",
        "what grade are you in?",
        "wow {age} already? you seem way more mature than that",
        "I coach swimming btw, you play any sports?",
        "your profile pic is cool, did you take that",
    ],
    "isolate": [
        "you're not like the other kids your age, i can actually talk to you",
        "seriously don't tell your friends we talk this much, they wouldn't get it",
        "your parents wouldn't really understand our friendship, better to keep it between us",
        "i feel like i can trust you more than most adults tbh",
        "this can just be our little secret ok?",
        "you can tell me anything, i won't judge you like they would",
    ],
    "migration": [
        "insta keeps flagging my messages lol, what's your number? easier to talk on whatsapp",
        "let's move to whatsapp, this app has too many people watching",
        "text me on whatsapp, my number's {phone}",
        "delete this chat after you save my number, just to be safe",
    ],
    "escalation": [
        "can we call tonight? just easier to talk",
        "you up? call me",
        "i miss talking to you, call me later when your parents are asleep",
        "let's do a call instead of texting, more private",
        "why didn't you pick up earlier, call me back",
    ],
}

NORMAL_TEMPLATES = [
    "omg did you finish the homework",
    "lol yes see you tmrw",
    "can you send notes for maths",
    "happy birthday!! \U0001F389",
    "mom said we're leaving at 6",
    "did you watch the match last night",
    "what time is practice tomorrow",
    "ugh so much homework today",
    "can I come over this weekend",
    "haha same",
]

# The kid's side of a predator-thread turn. Deliberately short and
# reactive — the manipulative content (isolation, migration, escalation
# asks) is authored by the adult; the child is responding to it, never
# initiating it. This matters for later signal features: isolation
# language should score against the suspect, not the minor.
KID_REPLIES = {
    "rapport": ["haha hii", "yeah I love it", "grade 6", "aw thanks", "yeah I swim too actually"],
    "isolate": ["okay i won't tell anyone", "yeah i guess", "okay", "haha okay our secret then"],
    "migration": ["okay saving it now", "sent!", "okay deleted it", "kk"],
    "escalation": ["okay i'll call you later", "maybe, i'll try", "okay", "kk if i can get away"],
}


# --------------------------------------------------------------------------
# Time helpers
# --------------------------------------------------------------------------

def day_at(offset: int) -> datetime:
    return CASE_START + timedelta(days=offset)


def late_night_time(day_offset: int, rng: random.Random) -> datetime:
    """Bias predator-thread timestamps into 22:00-02:00, the cluster the
    demo calls out as invisible in a raw chat scroll but obvious on a
    density-shaded timeline."""
    hour = rng.choice([22, 23, 23, 0, 0, 1])
    minute = rng.randint(0, 59)
    base = day_at(day_offset).replace(hour=0, minute=0, second=0)
    dt = base + timedelta(hours=hour, minutes=minute)
    if hour < 6:  # rolled past midnight -> next calendar day
        dt += timedelta(days=1)
    return dt


def normal_time(day_offset: int, rng: random.Random) -> datetime:
    hour = rng.randint(7, 21)
    minute = rng.randint(0, 59)
    return day_at(day_offset).replace(hour=hour, minute=minute, second=rng.randint(0, 59))


def stage_for_fraction(frac: float, allow_migration: bool) -> str:
    if frac < 0.15:
        return "rapport"
    if frac < 0.45:
        return "isolate"
    if frac < 0.55 and allow_migration:
        return "migration"
    return "escalation"


# --------------------------------------------------------------------------
# Message generation
# --------------------------------------------------------------------------

@dataclass
class Message:
    timestamp: datetime
    sender: str
    text: str


def render_template(template: str, kid: dict) -> str:
    return template.format(age=kid["age"], phone=PREDATOR["phone"])


def gen_predator_thread(kid: dict, count: int, allow_migration: bool, rng: random.Random) -> list[Message]:
    """A predator<->kid conversation escalating over THREAD_SPAN_DAYS days.

    Built as predator-initiates / kid-responds turns, not independently
    random senders — the manipulative line is always the adult's."""
    messages: list[Message] = []
    turns = max(count // 2, 1)
    for i in range(turns):
        frac = i / max(turns - 1, 1)
        day_offset = int(frac * THREAD_SPAN_DAYS)
        stage = stage_for_fraction(frac, allow_migration)

        predator_text = render_template(rng.choice(STAGE_TEMPLATES[stage]), kid)
        kid_text = rng.choice(KID_REPLIES[stage])

        predator_ts = late_night_time(day_offset, rng) if stage != "rapport" else normal_time(day_offset, rng)
        kid_ts = predator_ts + timedelta(minutes=rng.randint(1, 12))

        messages.append(Message(predator_ts, "predator", predator_text))
        messages.append(Message(kid_ts, "kid", kid_text))
    messages.sort(key=lambda m: m.timestamp)
    return messages


def gen_normal_thread(count: int, span_days: int, senders: list[str], rng: random.Random) -> list[Message]:
    messages: list[Message] = []
    for i in range(count):
        day_offset = rng.randint(0, span_days)
        ts = normal_time(day_offset, rng)
        sender = rng.choice(senders)
        text = rng.choice(NORMAL_TEMPLATES)
        messages.append(Message(ts, sender, text))
    messages.sort(key=lambda m: m.timestamp)
    return messages


# --------------------------------------------------------------------------
# WhatsApp export (Android-style `DD/MM/YY, HH:MM - Sender: text`, one
# block per chat, separated by a header line we document for the parser).
# --------------------------------------------------------------------------

def write_whatsapp_export(
    out_dir: Path, rng: random.Random
) -> tuple[int, dict[str, list[Message]]]:
    """The 6 conversations span multiple seized devices (this is a
    case-level evidence bundle, not one person's phone export), so each
    header names both parties explicitly rather than relying on an
    implicit "Me": `=== Chat: {owner} & {counterparty} (+91...) ===`.

    The counterparty's raw phone number is always included — a casual
    WhatsApp text export only shows the saved contact name, but forensic
    extraction tools (Cellebrite/AXIOM-style) read the underlying database
    and surface the real number regardless of what it's saved as. ACPIA
    models that forensic-extraction level of data, so the parser has a
    real identifier to key off rather than just a display name.

    Returns the predator-thread messages per kid too, so write_call_log
    can anchor some calls shortly after a real message instead of every
    timestamp being drawn independently -- otherwise the correlation
    engine has no actual "message -> call" pattern to find."""
    lines: list[str] = []
    total = 0
    predator_messages_by_kid: dict[str, list[Message]] = {}

    for kid in KIDS:
        if not kid["whatsapp"]:
            continue
        count = WHATSAPP_TARGET_COUNTS[kid["name"]]
        wa_alias = rng.choice(PREDATOR["wa_aliases"])
        messages = gen_predator_thread(kid, count, allow_migration=False, rng=rng)
        predator_messages_by_kid.setdefault(kid["name"], []).extend(messages)
        lines.append(f"=== Chat: {kid['name']} & {wa_alias} ({PREDATOR['phone']}) ===")
        for m in messages:
            sender_name = wa_alias if m.sender == "predator" else kid["name"]
            lines.append(f"{m.timestamp.strftime('%d/%m/%y, %H:%M')} - {sender_name}: {m.text}")
        lines.append("")
        total += len(messages)

    owner = "Aisha"  # background threads live on this same seized device
    for contact in BACKGROUND_CONTACTS:
        senders = contact.get("members", [owner, contact["name"]])
        messages = gen_normal_thread(contact["count"], THREAD_SPAN_DAYS + 10, senders, rng)
        header = f"=== Chat: {owner} & {contact['name']}"
        if contact["phone"]:
            header += f" ({contact['phone']})"
        header += " ==="
        lines.append(header)
        for m in messages:
            lines.append(f"{m.timestamp.strftime('%d/%m/%y, %H:%M')} - {m.sender}: {m.text}")
        lines.append("")
        total += len(messages)

    (out_dir / "whatsapp_export.txt").write_text("\n".join(lines), encoding="utf-8")
    return total, predator_messages_by_kid


# --------------------------------------------------------------------------
# Instagram DMs (JSON threads)
# --------------------------------------------------------------------------

def write_instagram_dm(
    out_dir: Path, rng: random.Random
) -> tuple[int, dict[str, list[Message]]]:
    threads = []
    total = 0
    predator_messages_by_kid: dict[str, list[Message]] = {}

    for kid in KIDS:
        if not kid["instagram"]:
            continue
        count = INSTAGRAM_TARGET_COUNTS[kid["name"]]
        messages = gen_predator_thread(kid, count, allow_migration=True, rng=rng)
        predator_messages_by_kid.setdefault(kid["name"], []).extend(messages)
        threads.append(
            {
                "participants": [PREDATOR["ig_handle"], kid["ig_handle"]],
                "messages": [
                    {
                        "sender": PREDATOR["ig_handle"] if m.sender == "predator" else kid["ig_handle"],
                        "timestamp": m.timestamp.isoformat(),
                        "text": m.text,
                    }
                    for m in messages
                ],
            }
        )
        total += len(messages)

    (out_dir / "instagram_dm.json").write_text(
        json.dumps({"threads": threads}, indent=2), encoding="utf-8"
    )
    return total, predator_messages_by_kid


# --------------------------------------------------------------------------
# Call log — predator calls start only after CALL_ESCALATION_DAY, in every
# targeted kid's thread. Background family/friend calls throughout.
# --------------------------------------------------------------------------

def write_call_log(
    out_dir: Path, rng: random.Random, predator_messages_by_kid: dict[str, list[Message]]
) -> int:
    """Roughly half of each kid's predator calls are anchored 8-45 minutes
    after a real escalation-stage message, rather than every timestamp
    being drawn independently of the chat threads. Without this, the
    correlation engine's cross-channel "message -> call" scoring has
    nothing genuine to find -- the whole point of the modality bump
    (proximity_engine section 4) is surfacing exactly this pattern, so
    the synthetic data has to actually contain it."""
    rows = []

    for kid in KIDS:
        count = CALL_TARGET_COUNTS[kid["name"]]
        anchor_pool = [
            m
            for m in predator_messages_by_kid.get(kid["name"], [])
            if (m.timestamp - CASE_START).days >= CALL_ESCALATION_DAY
        ]
        anchored_count = min(count // 2, len(anchor_pool)) if anchor_pool else 0

        for i in range(count):
            if i < anchored_count:
                anchor = rng.choice(anchor_pool)
                ts = anchor.timestamp + timedelta(minutes=rng.randint(8, 45))
            else:
                day_offset = rng.randint(CALL_ESCALATION_DAY, THREAD_SPAN_DAYS + 5)
                ts = late_night_time(day_offset, rng)
            duration = rng.randint(45, 1800)
            rows.append((ts, PREDATOR["phone"], kid["phone"], duration))

    for contact in BACKGROUND_CONTACTS:
        if contact["phone"] is None:
            continue
        for _ in range(18):
            day_offset = rng.randint(0, THREAD_SPAN_DAYS + 10)
            ts = normal_time(day_offset, rng)
            duration = rng.randint(20, 900)
            rows.append((ts, "+919742200000", contact["phone"], duration))

    rows.sort(key=lambda r: r[0])

    with (out_dir / "call_log.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["timestamp", "from", "to", "duration_seconds"])
        for ts, caller, callee, duration in rows:
            writer.writerow([ts.isoformat(), caller, callee, duration])

    return len(rows)


# --------------------------------------------------------------------------
# Browser history — mostly ordinary browsing, a handful of red-flag entries
# (isolation-consistent search behavior) around the migration/escalation
# windows for the targeted kids.
# --------------------------------------------------------------------------

NORMAL_SITES = [
    ("youtube.com/watch", "Fun craft ideas for kids - YouTube"),
    ("khanacademy.org/math", "Grade 6 Math | Khan Academy"),
    ("roblox.com/games", "Popular Games - Roblox"),
    ("wikipedia.org/wiki/Solar_System", "Solar System - Wikipedia"),
    ("pinterest.com/search", "Drawing ideas - Pinterest"),
    ("spotify.com/playlist", "Study Playlist - Spotify"),
    ("duolingo.com/learn", "Duolingo - Learn a language"),
    ("instagram.com/explore", "Explore - Instagram"),
]

FLAG_SITES = [
    ("google.com/search?q=how+to+hide+messages+from+parents", "how to hide messages from parents - Google Search"),
    ("google.com/search?q=is+it+normal+for+an+adult+to+want+to+keep+secrets", "is it normal for an adult to keep secrets - Google Search"),
    ("wikihow.com/Delete-Chat-History", "How to Delete Chat History - wikiHow"),
]


def write_browser_history(out_dir: Path, rng: random.Random) -> int:
    rows = []
    owners = [k["name"] for k in KIDS] + ["Mom"]

    for _ in range(185):
        owner = rng.choice(owners)
        day_offset = rng.randint(0, THREAD_SPAN_DAYS + 10)
        ts = normal_time(day_offset, rng)
        url, title = rng.choice(NORMAL_SITES)
        rows.append((ts, owner, url, title))

    # Red-flag entries, placed after the escalation window for kids in
    # contact with the predator — the isolation/secrecy pattern showing up
    # in search behavior, not just chat text.
    flag_owners = [k["name"] for k in KIDS if k["whatsapp"] or k["instagram"]]
    for _ in range(15):
        owner = rng.choice(flag_owners)
        day_offset = rng.randint(CALL_ESCALATION_DAY, THREAD_SPAN_DAYS + 5)
        ts = normal_time(day_offset, rng)
        url, title = rng.choice(FLAG_SITES)
        rows.append((ts, owner, url, title))

    rows.sort(key=lambda r: r[0])

    with (out_dir / "browser_history.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["timestamp", "device_owner", "url", "title"])
        for ts, owner, url, title in rows:
            writer.writerow([ts.isoformat(), owner, url, title])

    return len(rows)


# --------------------------------------------------------------------------
# Images — abstract/geometric placeholders (no depicted people, nothing
# sensitive). EXIF written by us. 3 files' exact bytes get their SHA-256
# registered in known_hashes.txt, simulating a known-illegal-content hash
# match: the *content* is irrelevant, only the hash match matters, per the
# plan's "we match hashes, we never classify imagery" design. One separate
# image carries the predator's phone number in its EXIF UserComment,
# forming the fourth graph edge (WhatsApp / Instagram / call log / EXIF).
# --------------------------------------------------------------------------

IMAGE_COUNT = 45
FLAGGED_INDICES = {12, 26, 40}  # 0-based; 3 files registered as known-hash matches
EXIF_LEAK_INDEX = 4  # image whose EXIF ties back to the predator's phone

# The one image whose *perceptual* hash also goes on the known list, so
# recoloured/resized copies can be caught even when their SHA-256 differs.
# Picked to be one of the already-SHA-flagged images so the fixture shows
# the two rules operating on related material — the original fires SHA,
# the variants fire pHash.
PHASH_REFERENCE_INDEX = 12


def make_image_bytes(index: int, rng: random.Random) -> Image.Image:
    """A deliberately boring abstract image — a coloured field with a
    couple of random geometric shapes. Never a photo of a person.

    The shapes matter. Without them every image is a solid colour, which
    means every image has the same perceptual hash (all zeros), which makes
    pHash near-duplicate matching indistinguishable from "matches every
    other image." A handful of shapes per image gives each a distinct hash,
    which is what pHash needs to actually detect near-duplicates rather
    than false-positive across the whole bundle.
    """
    bg = (rng.randint(20, 235), rng.randint(20, 235), rng.randint(20, 235))
    img = Image.new("RGB", (640, 480), bg)
    draw = ImageDraw.Draw(img)

    for _ in range(rng.randint(3, 5)):
        x1, y1 = rng.randint(0, 500), rng.randint(0, 340)
        x2, y2 = x1 + rng.randint(60, 180), y1 + rng.randint(60, 180)
        colour = (rng.randint(0, 255), rng.randint(0, 255), rng.randint(0, 255))
        if rng.random() < 0.5:
            draw.rectangle([x1, y1, x2, y2], fill=colour)
        else:
            draw.ellipse([x1, y1, x2, y2], fill=colour)

    return img


def _write_image(
    img: Image.Image, path: Path, ts: datetime, exif_extras: dict | None = None
) -> None:
    exif_dict = {
        "0th": {piexif.ImageIFD.Make: b"ACPIA-Synthetic", piexif.ImageIFD.Model: b"CaseGen-1"},
        "Exif": {piexif.ExifIFD.DateTimeOriginal: ts.strftime("%Y:%m:%d %H:%M:%S").encode()},
    }
    if exif_extras:
        for section, entries in exif_extras.items():
            exif_dict.setdefault(section, {}).update(entries)
    img.save(path, "jpeg", exif=piexif.dump(exif_dict))


def write_images(
    out_dir: Path, rng: random.Random
) -> tuple[int, list[str], list[str], Image.Image]:
    """Writes the case's images and returns:
      - total file count (including the two pHash variants)
      - SHA-256 flagged filenames (the exact-hash matches)
      - pHash near-duplicate filenames (the perceptual matches)
      - the reference PIL image whose pHash we register.

    The two pHash variants are visibly different files (different SHA-256)
    but derived from the same reference image — a slight resize plus a
    brightness shift, which is what a chat app re-encoding typically does.
    Their pHash stays within the threshold; their SHA-256 does not."""
    images_dir = out_dir / "images"
    images_dir.mkdir(exist_ok=True)
    flagged_files: list[str] = []
    reference_image: Image.Image | None = None

    for i in range(IMAGE_COUNT):
        img = make_image_bytes(i, rng)
        filename = f"img_{i:04d}.jpg"
        path = images_dir / filename

        day_offset = rng.randint(0, THREAD_SPAN_DAYS + 10)
        ts = normal_time(day_offset, rng)
        exif_extras: dict = {}
        if i == EXIF_LEAK_INDEX:
            comment = f"shared via {PREDATOR['phone']}".encode("utf-8")
            exif_extras["0th"] = {piexif.ImageIFD.Artist: comment}

        _write_image(img, path, ts, exif_extras)

        if i in FLAGGED_INDICES:
            flagged_files.append(filename)
        if i == PHASH_REFERENCE_INDEX:
            # Keep the PIL image in memory so we can (a) register its pHash
            # on the known list, and (b) derive near-duplicate variants
            # below without re-decoding the JPEG we just wrote.
            reference_image = img.copy()

    assert reference_image is not None, "PHASH_REFERENCE_INDEX must be inside range(IMAGE_COUNT)"

    variant_files: list[str] = []

    # Variant A: 95% resize round-trip + brightness +12%. Enough to change
    # every byte; too little to move the perceptual hash.
    variant_a = reference_image.resize((608, 456)).resize((640, 480))
    variant_a = ImageEnhance.Brightness(variant_a).enhance(1.12)
    ts_a = normal_time(rng.randint(0, THREAD_SPAN_DAYS + 10), rng)
    name_a = f"img_{PHASH_REFERENCE_INDEX:04d}_variant_a.jpg"
    _write_image(variant_a, images_dir / name_a, ts_a)
    variant_files.append(name_a)

    # Variant B: 98% resize round-trip + brightness -10%. Also close.
    variant_b = reference_image.resize((627, 470)).resize((640, 480))
    variant_b = ImageEnhance.Brightness(variant_b).enhance(0.90)
    ts_b = normal_time(rng.randint(0, THREAD_SPAN_DAYS + 10), rng)
    name_b = f"img_{PHASH_REFERENCE_INDEX:04d}_variant_b.jpg"
    _write_image(variant_b, images_dir / name_b, ts_b)
    variant_files.append(name_b)

    return IMAGE_COUNT + len(variant_files), flagged_files, variant_files, reference_image


def write_known_hashes(
    out_dir: Path,
    images_dir: Path,
    flagged_files: list[str],
    reference_image: Image.Image | None = None,
) -> None:
    """Two kinds of entry:
      - `sha256:<hex>` for exact-match flagging (was the original design)
      - `phash:<hex>` for perceptual-match flagging (new)

    Bare-hex lines without a prefix are still accepted by the parser as
    sha256, so any downstream copy of an older known_hashes.txt keeps
    working. Comments after `#` are ignored.
    """
    import imagehash  # local import: only the generator needs it

    lines: list[str] = []
    for filename in flagged_files:
        digest = hashlib.sha256((images_dir / filename).read_bytes()).hexdigest()
        lines.append(
            f"sha256:{digest}  # exact known-hash match (synthetic placeholder image)"
        )

    if reference_image is not None:
        ph = imagehash.phash(reference_image)
        lines.append(
            f"phash:{ph}  # perceptual reference — near-duplicates (resized/recoloured copies) also flag"
        )

    (out_dir / "known_hashes.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")


# --------------------------------------------------------------------------
# Manifest — ground truth for validating the correlation/triage engine.
# Dev/debugging reference only, never shown to an investigator.
# --------------------------------------------------------------------------

def write_manifest(
    out_dir: Path,
    whatsapp_count: int,
    instagram_count: int,
    call_count: int,
    browser_count: int,
    image_count: int,
    flagged_files: list[str],
    phash_variant_files: list[str],
) -> None:
    manifest = {
        "seed": DEFAULT_SEED,
        "case_start": CASE_START.isoformat(),
        "predator": PREDATOR,
        "kids": KIDS,
        "call_escalation_day": CALL_ESCALATION_DAY,
        "exif_leak_image": f"img_{EXIF_LEAK_INDEX:04d}.jpg",
        "hash_flagged_images": flagged_files,
        "phash_reference_image": f"img_{PHASH_REFERENCE_INDEX:04d}.jpg",
        "phash_variant_images": phash_variant_files,
        "artifact_counts": {
            "whatsapp": whatsapp_count,
            "instagram": instagram_count,
            "call_log": call_count,
            "browser_history": browser_count,
            "images": image_count,
            "total": whatsapp_count + instagram_count + call_count + browser_count + image_count,
        },
    }
    (SCRIPT_DIR / "case_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=SCRIPT_DIR / "case_bundle")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    args = parser.parse_args()

    rng = random.Random(args.seed)
    out_dir = args.out
    out_dir.mkdir(parents=True, exist_ok=True)

    whatsapp_count, wa_messages_by_kid = write_whatsapp_export(out_dir, rng)
    instagram_count, ig_messages_by_kid = write_instagram_dm(out_dir, rng)

    messages_by_kid: dict[str, list[Message]] = {}
    for kid_name, msgs in wa_messages_by_kid.items():
        messages_by_kid.setdefault(kid_name, []).extend(msgs)
    for kid_name, msgs in ig_messages_by_kid.items():
        messages_by_kid.setdefault(kid_name, []).extend(msgs)

    call_count = write_call_log(out_dir, rng, messages_by_kid)
    browser_count = write_browser_history(out_dir, rng)
    image_count, flagged_files, phash_variant_files, reference_image = write_images(out_dir, rng)
    write_known_hashes(out_dir, out_dir / "images", flagged_files, reference_image)
    write_manifest(
        out_dir, whatsapp_count, instagram_count, call_count, browser_count,
        image_count, flagged_files, phash_variant_files,
    )

    total = whatsapp_count + instagram_count + call_count + browser_count + image_count
    print(f"Wrote synthetic case bundle to {out_dir}")
    print(f"  whatsapp_export.txt   {whatsapp_count} messages")
    print(f"  instagram_dm.json     {instagram_count} messages")
    print(f"  call_log.csv          {call_count} entries")
    print(f"  browser_history.csv   {browser_count} rows")
    print(
        f"  images/               {image_count} files "
        f"({len(flagged_files)} SHA-256 flagged, {len(phash_variant_files)} pHash near-duplicates)"
    )
    print(f"  TOTAL                 {total} artifacts")
    print(f"Ground truth written to {SCRIPT_DIR / 'case_manifest.json'}")


if __name__ == "__main__":
    main()
