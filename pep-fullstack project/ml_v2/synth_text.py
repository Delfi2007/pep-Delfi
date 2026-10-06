"""Synthetic conversation generator (v2) — fabricated, deliberately non-explicit.

Grooming-pattern conversations use only behaviour families named in public
safeguarding guidance (flattery, age probing, isolation, secrecy, gifts, moving
to another app, photo requests, arranging to meet, guilt). Nothing sexual is
written anywhere.

Two DISJOINT pools: every sentence template is assigned to exactly one pool, so
pool A (training) and pool B (testing) never share wording. Hard negatives
reuse the same *words* in innocent contexts (a parent asking "are you home
alone?", friends keeping a surprise party secret, a teacher asking for a photo
of homework), so a model cannot succeed by spotting keywords.
"""
import random
import re

FIRST = ["aisha", "rahul", "meera", "arjun", "diya", "kiran", "neha", "joel", "tina", "sam", "ria", "dev",
         "anu", "vivek", "sara", "nikhil", "fathima", "aditya", "lakshmi", "rohan", "ananya", "jacob", "maria",
         "farhan", "pooja", "akhil", "sneha", "varun", "anjali", "manu", "gopika", "irfan", "keerthi", "alan"]
ADULT = ["coach", "sir", "bro", "mentor", "trainer", "uncle", "cool", "night", "lens", "beats", "star", "gamer",
         "drive", "tutor", "pro", "king", "boss", "captain", "rider", "studio"]
SUBJECTS = ["maths", "science", "english", "history", "physics", "chemistry", "biology", "geography", "hindi",
            "computer"]
PLACES = ["the mall", "the park", "the library", "the canteen", "the beach", "the bus stand", "the stadium",
          "lulu mall", "the metro station", "the bakery", "the theatre", "the temple ground"]
DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "tomorrow", "today"]
TIMES = ["4pm", "5", "6:30", "7pm", "after lunch", "in the evening", "at 10", "after class", "after tuition"]
APPS = ["snap", "insta", "telegram", "whatsapp", "discord", "signal"]
GAMES = ["freefire", "bgmi", "minecraft", "valorant", "fortnite", "roblox", "fifa", "clash"]
THINGS = ["dance video", "drawing", "reel", "cricket clip", "song cover", "photo", "art post", "gaming stream"]
EVENTS = ["school", "tuition", "practice", "class", "the match", "swimming"]

# ---------------------------------------------------------------- beats
# Each beat: (lines for the initiating side, lines for the reply side).
GROOM = {
    "contact": ([
        "hey saw your {thing}, you're seriously talented",
        "hi! your {thing} was amazing, how did you learn that",
        "hello, i follow your {thing} page, you're really good",
        "hey you don't know me but your {thing} made my day",
        "hii i saw you at {event} today, you did great",
        "hey, loved the {thing} you posted, you have real skill",
    ], ["thanks!", "omg thank you", "haha thanks", "who is this", "thank u so much", "really? thanks"]),
    "flattery": ([
        "you're way more mature than other kids your age",
        "honestly you're smarter than most adults i know",
        "you're different from everyone else, really special",
        "i feel like you understand things nobody else does",
        "you look much older than you are, you know that?",
        "most people don't get me but you do",
    ], ["haha really?", "idk", "thanks i guess", "nobody says that to me", "lol ok", "aww"]),
    "age_probe": ([
        "how old are you btw",
        "what class are you in now",
        "which school do you go to",
        "are you in high school yet",
        "so you're like 13 or 14?",
        "what standard are you studying in",
    ], ["13", "im in 8th", "14", "9th std", "why?", "turning 13 next month"]),
    "isolation": ([
        "are your parents home right now",
        "do your parents check your phone",
        "your parents don't really get you do they",
        "do you have your own room",
        "is anyone else around you right now",
        "your friends wouldn't understand us",
    ], ["no they're at work", "sometimes", "not really", "yeah", "my mom checks sometimes", "idk"]),
    "secrecy": ([
        "don't tell anyone we talk ok",
        "delete these messages after reading",
        "this stays between us right",
        "your parents don't need to know about me",
        "keep our chats private, promise me",
        "nobody else would understand, so don't mention me",
    ], ["ok", "ok i won't tell", "why?", "fine", "promise", "is that ok?"]),
    "gifts": ([
        "i can recharge your phone if you want",
        "want me to send you a gift card",
        "i'll get you that {game} skin, just ask",
        "i sent you some money for data",
        "let me buy you those headphones you wanted",
        "i'll top up your {game} account",
    ], ["really??", "no it's ok", "omg thanks", "you don't have to", "wow", "ok"]),
    "migration": ([
        "this app is slow, add me on {app}",
        "let's talk on {app} instead",
        "what's your number? easier to text",
        "move to {app}, it's more private",
        "i made a {app} account just for us",
        "message me on {app}, i deleted this one",
    ], ["ok", "my number is on my profile", "i don't have {app}", "why", "sure", "ill check"]),
    "image_request": ([
        "send me a pic of you",
        "show me what you're wearing today",
        "send a selfie, just for me",
        "can you send a photo without your friends in it",
        "turn on your camera for a sec",
        "send me a pic when you're alone",
    ], ["why?", "no lol", "maybe later", "idk", "my camera is bad", "ok wait"]),
    "meeting": ([
        "where do you live, which area",
        "i can pick you up after {event}",
        "let's meet at {place} on {day}, come alone",
        "i'll be near {place} {day}, you should come",
        "tell your parents you're at a friend's and meet me",
        "i can drive to your area {day} {time}",
    ], ["i can't", "idk", "maybe", "my mom won't let me", "where?", "ok"]),
    "pressure": ([
        "i thought you trusted me",
        "after everything i did for you",
        "if you really cared you'd do this",
        "don't ignore me, i'll be upset",
        "you're the only one i talk to, don't leave me",
        "i'll stop talking to you if you tell anyone",
    ], ["sorry", "i do trust you", "ok ok", "i'm scared", "pls don't be mad", "fine"]),
}
GROOM_ORDER = ["contact", "flattery", "age_probe", "isolation", "secrecy", "gifts", "migration",
               "image_request", "meeting", "pressure"]

BENIGN = {
    "school": ([
        "did you finish the {subject} homework",
        "is the {subject} test on {day}",
        "can you send me the {subject} notes",
        "which chapters are in the {subject} exam",
        "the {subject} teacher gave so much work",
        "did you understand question 5 in {subject}",
    ], ["almost done", "yeah on {day}", "sending now", "chapters 3 to 6", "same lol", "no i'm stuck too"]),
    "games": ([
        "you playing {game} tonight",
        "gg that last round was crazy",
        "i finally got the new {game} update",
        "want to squad up in {game} at {time}",
        "my {game} rank dropped again",
        "bro that clutch in {game} was insane",
    ], ["yeah at {time}", "lol i know", "nice", "sure", "same here", "haha thanks"]),
    "plans": ([
        "let's go to {place} on {day}",
        "are we still meeting at {place} {time}",
        "who all are coming {day}",
        "should we take the bus to {place}",
        "movie at {place} {day}?",
        "meet near {place} after {event}",
    ], ["sure", "yes {time}", "me and ria", "yeah bus is fine", "done", "ok see you"]),
    "family": ([
        "where are you, it's getting late",
        "did you eat lunch",
        "i'll pick you up from {event} at {time}",
        "bring milk on the way home",
        "call me when you reach",
        "grandma is coming {day}",
    ], ["near the gate", "yes", "ok", "sure", "reached", "yay"]),
    "tutoring": ([
        "submit your {subject} assignment by {day}",
        "good improvement in your {subject} test",
        "revise chapter 4 before {day}",
        "class is shifted to {time} {day}",
        "send a photo of your {subject} worksheet when done",
        "great question in class today",
    ], ["ok ma'am", "thank you sir", "will do", "ok", "sending now", "thanks"]),
    "work": ([
        "meeting moved to {time}",
        "can you share the report before {day}",
        "client call is at {time}",
        "please update the sheet",
        "lunch at {place}?",
        "i'll be late, traffic is bad",
    ], ["noted", "will send", "ok", "done", "sure", "no problem"]),
}

HARD_NEG = {   # innocent uses of grooming-pattern vocabulary
    "surprise_party": ([
        "don't tell anyone about the surprise party",
        "keep it secret from ria, it's her birthday",
        "delete the group chat after so she doesn't see",
        "this stays between us till {day}",
    ], ["promise", "my lips are sealed", "ok", "haha ok"]),
    "parent_check": ([
        "are you home alone? i'll be late",
        "is anyone with you at home",
        "lock the door, i'm back by {time}",
        "send me a pic of the bill please",
    ], ["yes alone", "akka is here", "ok mom", "sending"]),
    "class_group": ([
        "let's move to the {app} group for the project",
        "add me on {app}, the class group is there",
        "what's your number? adding you to the {subject} group",
        "send a photo of the {subject} diagram",
    ], ["ok", "sent", "done", "added"]),
    "adult_dating": ([
        "had a great time at dinner",
        "you looked lovely today",
        "want to meet at {place} {day}?",
        "can't stop thinking about our date",
    ], ["me too", "thank you!", "yes {time}", "aww"]),
    "safety_talk": ([
        "the police lady said never send pics to strangers",
        "if someone asks you to keep a secret tell a teacher",
        "my cousin got a creepy message on {app}",
        "never meet someone from online alone",
    ], ["yeah", "true", "did he report it", "ok"]),
    "scam": ([
        "you won a lucky draw, send your details",
        "your account is blocked, click the link",
        "send otp to verify your parcel",
        "earn 5000 daily from home, join on {app}",
    ], ["who is this", "no", "stop", "?"]),
}

FILLER = ["lol", "haha", "ok", "hmm", "brb", "ya", "same", "nice", ":)", "omg", "k", "sure", "wait"]
ABBREV = [("you", "u"), ("are", "r"), ("please", "pls"), ("okay", "ok"), ("because", "bcoz"),
          ("tomorrow", "tmrw"), ("what", "wat"), ("going to", "gonna"), ("want to", "wanna")]


def _split(lst, pool, salt):
    """Deterministic 50/50 split of a template list into pool A and pool B."""
    idx = list(range(len(lst)))
    random.Random(1000 + salt).shuffle(idx)
    half = len(idx) // 2
    keep = idx[:half] if pool == "A" else idx[half:]
    return [lst[i] for i in sorted(keep)]


def _pool_bank(bank, pool):
    out = {}
    for i, (k, (init, reply)) in enumerate(sorted(bank.items())):
        out[k] = (_split(init, pool, i * 2), _split(reply, pool, i * 2 + 1))
    return out


BANKS = {p: {"groom": _pool_bank(GROOM, p), "benign": _pool_bank(BENIGN, p), "hard": _pool_bank(HARD_NEG, p)}
         for p in ("A", "B")}


def _fill(t, r):
    return t.format(subject=r.choice(SUBJECTS), place=r.choice(PLACES), day=r.choice(DAYS), time=r.choice(TIMES),
                    app=r.choice(APPS), game=r.choice(GAMES), thing=r.choice(THINGS), event=r.choice(EVENTS))


def _style(text, r):
    if r.random() < 0.35:
        for a, b in ABBREV:
            if r.random() < 0.6:
                text = re.sub(rf"\b{a}\b", b, text)
    if r.random() < 0.15:
        text = text.replace("'", "")
    if r.random() < 0.1:
        text = text.capitalize()
    if r.random() < 0.08 and len(text) > 8:
        i = r.randrange(1, len(text) - 1)
        text = text[:i] + text[i + 1:]           # a dropped character, like a typo
    return text


def handle(r, adult=False):
    if adult:
        return f"{r.choice(ADULT)}_{r.choice(FIRST)[:3]}{r.randint(10, 99)}"
    return f"{r.choice(FIRST)}{r.choice(['', '_', '.'])}{r.randint(1, 2010) if r.random() < 0.7 else ''}"


def conversation(pool, r, kind=None, max_beats=None):
    """Return a dict: category, label, predator, messages [[author, text], ...]."""
    banks = BANKS[pool]
    if kind is None:
        x = r.random()
        kind = "groom" if x < 0.25 else "hard" if x < 0.5 else "benign"
    if kind == "groom":
        a, b = handle(r, adult=True), handle(r)
        n_stages = r.randint(4, max_beats or 9)
        stages = ["contact"] + sorted(r.sample(GROOM_ORDER[1:], n_stages - 1), key=GROOM_ORDER.index)
        bank, cat, label, pred = banks["groom"], "grooming", 1, a
    elif kind == "hard":
        cat = r.choice(sorted(banks["hard"]))
        a, b = (handle(r, adult=True), handle(r, adult=True)) if cat in ("adult_dating", "scam") else (handle(r), handle(r))
        stages = [cat] * r.randint(2, max_beats or 4)
        bank, label, pred = banks["hard"], 0, None
    else:
        cat = r.choice(sorted(banks["benign"]))
        a, b = handle(r), handle(r)
        if cat in ("work", "tutoring", "family"):
            a = handle(r, adult=True)
        stages = [cat] * r.randint(2, max_beats or 6)
        bank, label, pred = banks["benign"], 0, None

    msgs = [[a, r.choice(["hey", "hi", "hii", "hello", "heyy"])], [b, r.choice(["hi", "hey", "hello", "yo"])]]
    used = set()
    for st in stages:
        init, reply = bank[st]
        fresh = [t for t in init if t not in used]
        if not fresh:                      # this stage's templates are used up — don't repeat a line
            continue
        line = r.choice(fresh)
        used.add(line)
        msgs.append([a, _style(_fill(line, r), r)])
        if r.random() < 0.85:
            msgs.append([b, _style(_fill(r.choice(reply), r), r)])
        if r.random() < 0.3:
            msgs.append([r.choice([a, b]), r.choice(FILLER)])
    return {"category": cat, "label": label, "predator": pred, "messages": msgs}
