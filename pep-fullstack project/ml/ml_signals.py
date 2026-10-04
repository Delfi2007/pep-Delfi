"""Interpretable behavioural signals — the same idea as ACPIA's backend/signals.py.

Phrase lexicons for recognised grooming-pattern families plus simple style statistics.
They are used two ways:
  * as features for the `behavioral_hgb` model (gradient boosting), and
  * by the API to explain *why* a conversation scored high, independent of the model.

The lexicons are deliberately short and generic. They describe behaviour patterns
(asking a child's age, asking for secrecy, moving to another app, arranging to meet)
that appear in public safeguarding guidance; they are not a list of explicit content.
"""
import re

import numpy as np

LEXICONS = {
    "age_probe": [r"how old", r"\basl\b", r"what grade", r"which grade", r"your age", r"\bage\?",
                  r"what school", r"which school", r"are you \d+", r"r u \d+"],
    "secrecy": [r"don'?t tell", r"dont tell", r"do not tell", r"our secret", r"keep (it|this) (a )?secret",
                r"delete (this|the|our|these)", r"between us", r"no one (has to|needs to) know",
                r"don'?t show"],
    "isolation": [r"home alone", r"are you alone", r"r u alone", r"parents (home|around|there)",
                  r"your (mom|mum|dad|parents) (home|around|know)", r"nobody understands you",
                  r"only i understand", r"they don'?t understand you"],
    "platform_migration": [r"\bcam\b", r"webcam", r"web cam", r"phone number", r"your number",
                           r"text me", r"call me", r"\bskype\b", r"\bmsn\b", r"\byahoo\b", r"\baim\b",
                           r"other app", r"another app", r"\bsnap(chat)?\b", r"\bwhatsapp\b",
                           r"\btelegram\b", r"add me on"],
    "meeting": [r"\bmeet\b", r"meet up", r"come over", r"pick you up", r"pick u up", r"\bdrive\b",
                r"see you in person", r"\bhotel\b", r"your address", r"where do you live",
                r"where u live", r"after school"],
    "flattery": [r"\bcute\b", r"\bpretty\b", r"beautiful", r"\bhot\b", r"\bsexy\b",
                 r"mature for your age", r"so mature", r"\bgorgeous\b"],
    "relationship": [r"love you", r"luv u", r"miss you", r"miss u", r"boyfriend", r"girlfriend",
                     r"\bbf\b", r"\bgf\b", r"\bbaby\b", r"\bbabe\b", r"\bdate\b"],
    "image_request": [r"send (me )?(a )?(pic|photo|picture)", r"\bpics?\b", r"\bphoto\b",
                      r"show me", r"what are you wearing", r"what r u wearing"],
    "sexual_term": [r"\bsex\b", r"\bnaked\b", r"\bnude", r"\bkiss", r"\btouch", r"\bvirgin\b",
                    r"\bhorny\b", r"\bbra\b", r"\bundress"],
}

_COMPILED = {k: [re.compile(p, re.I) for p in v] for k, v in LEXICONS.items()}
_TOKEN = re.compile(r"\w+")
SECOND_PERSON = {"you", "u", "ur", "your", "youre", "yourself", "ya"}
FIRST_PERSON = {"i", "im", "me", "my", "mine", "myself"}

FEATURE_NAMES = (
    ["n_messages_log", "chars_log", "avg_msg_len", "question_rate", "exclaim_rate",
     "second_person_rate", "first_person_rate", "upper_ratio", "digit_ratio", "url_count"]
    + [f"lex_{k}" for k in LEXICONS]
    + [f"lex_{k}_any" for k in LEXICONS]
    + ["lex_categories_hit"]
)


def signal_hits(text):
    """{category: [matched phrases]} for a block of text."""
    hits = {}
    for cat, pats in _COMPILED.items():
        found = []
        for p in pats:
            found += [m.group(0).lower() for m in p.finditer(text)]
        if found:
            hits[cat] = found
    return hits


def features(text):
    msgs = [m for m in text.split("\n") if m.strip()] or [""]
    tokens = [t.lower() for t in _TOKEN.findall(text)]
    n_tok = max(1, len(tokens))
    letters = [ch for ch in text if ch.isalpha()]
    hits = signal_hits(text)
    per100 = {k: 100 * len(hits.get(k, [])) / n_tok for k in LEXICONS}
    row = [
        np.log1p(len(msgs)),
        np.log1p(len(text)),
        len(text) / len(msgs),
        sum("?" in m for m in msgs) / len(msgs),
        sum("!" in m for m in msgs) / len(msgs),
        sum(t in SECOND_PERSON for t in tokens) / n_tok,
        sum(t in FIRST_PERSON for t in tokens) / n_tok,
        sum(ch.isupper() for ch in letters) / max(1, len(letters)),
        sum(ch.isdigit() for ch in text) / max(1, len(text)),
        text.count("http") + text.count("www."),
    ]
    row += [per100[k] for k in LEXICONS]
    row += [float(k in hits) for k in LEXICONS]
    row += [float(len(hits))]
    return row


def feature_matrix(texts):
    return np.array([features(t) for t in texts], dtype=np.float32)
