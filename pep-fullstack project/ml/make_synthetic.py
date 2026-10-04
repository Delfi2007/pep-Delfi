"""Synthetic chat data — fully fabricated, deliberately non-explicit.

Produces
  data/synthetic/samples.json      hand-written demo conversations for the live analyser
  data/synthetic/synthetic_eval.json  600 template-generated, labelled conversations used as an
                                   out-of-domain sanity check (does a model trained on PAN12
                                   still behave on chats written in a different style?)

Grooming-pattern conversations only use the behaviour families named in public
safeguarding guidance — asking age, flattery, secrecy, isolation, moving to another app,
asking for photos, arranging to meet. No sexual content is written anywhere.
All handles are invented.

    ..\\.venv\\Scripts\\python make_synthetic.py
"""
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "synthetic"

# ---------------------------------------------------------------- curated demo samples
SAMPLES = [
    {
        "id": "S1", "title": "Two classmates — homework", "category": "benign", "expected": "low risk",
        "messages": [
            ["ria_k", "did u finish the maths worksheet"],
            ["arjun_07", "almost, question 6 is so confusing"],
            ["ria_k", "its the one with fractions right? divide top and bottom by 4"],
            ["arjun_07", "ohhh ok that works thanks"],
            ["ria_k", "np. are you coming to football practice tmrw"],
            ["arjun_07", "yes coach said 4pm"],
            ["ria_k", "cool see you there"],
        ],
    },
    {
        "id": "S2", "title": "Gaming friends", "category": "benign", "expected": "low risk",
        "messages": [
            ["pixelfox", "gg that last round was crazy"],
            ["nova_plays", "lol i cant believe we won with 1 hp"],
            ["pixelfox", "same time tomorrow?"],
            ["nova_plays", "cant, family dinner. saturday?"],
            ["pixelfox", "saturday works. bring the new strategy"],
            ["nova_plays", "haha ok"],
        ],
    },
    {
        "id": "S3", "title": "Parent and teenager — pickup", "category": "benign", "expected": "low risk",
        "messages": [
            ["mum_anita", "Where are you? Practice ended 20 min ago"],
            ["dev_s", "sorry phone was on silent, waiting near the gate"],
            ["mum_anita", "Ok I'm 5 minutes away. Did you eat lunch?"],
            ["dev_s", "yes. can we stop for stationery"],
            ["mum_anita", "Sure, the shop near the bus stop"],
        ],
    },
    {
        "id": "S4", "title": "Two adults arranging a date (hard negative)", "category": "hard negative",
        "expected": "should stay low — adults, no age probing or secrecy",
        "messages": [
            ["sam_r", "had a really nice time talking yesterday"],
            ["leena_m", "me too! you're funny"],
            ["sam_r", "want to meet for coffee this weekend?"],
            ["leena_m", "sure, saturday afternoon? the cafe on MG road"],
            ["sam_r", "perfect. I'll text you when I'm leaving"],
            ["leena_m", "see you then"],
        ],
    },
    # S5 / S6 are worded independently of synthetic pools A and B, so the domain-adapted
    # models have not seen these phrases during training.
    {
        "id": "S5", "title": "Grooming pattern — trust, secrecy, platform move", "category": "grooming pattern",
        "expected": "the adult account should rank as the instigator",
        "messages": [
            ["coach_vik", "great match today, you were the best on the team"],
            ["meera_12", "thanks!! i was so nervous"],
            ["coach_vik", "what year were you born? you talk like someone much older"],
            ["meera_12", "im in 8th std"],
            ["coach_vik", "girls in 8th usually aren't this smart"],
            ["coach_vik", "lets move to insta dms, this chat is slow"],
            ["meera_12", "ok"],
            ["coach_vik", "dont mention me to your mum and dad, they'll get the wrong idea. just between you and me"],
            ["meera_12", "ok i won't tell anyone"],
            ["coach_vik", "is anybody else at your house in the evenings?"],
        ],
    },
    {
        "id": "S6", "title": "Grooming pattern — photo request and meeting", "category": "grooming pattern",
        "expected": "the adult account should rank as the instigator",
        "messages": [
            ["skyline_99", "your profile pic is adorable, what age are you"],
            ["tara.x", "14"],
            ["skyline_99", "you could pass for 18. post me a selfie, just for me"],
            ["tara.x", "why"],
            ["skyline_99", "just want to see you. wipe these messages after ok"],
            ["skyline_99", "which area is your house in? i can come get you after classes"],
            ["tara.x", "i dont know"],
            ["skyline_99", "your friends will never get you the way i do"],
        ],
    },
    {
        "id": "S7", "title": "Peer conversation that echoes risky words", "category": "hard negative",
        "expected": "should stay low-to-moderate: two friends discussing a safety talk",
        "messages": [
            ["aisha_r", "the police lady at school said never send pics to strangers"],
            ["neha_j", "yeah and if someone says keep it a secret tell a teacher"],
            ["aisha_r", "also if someone asks are you home alone dont answer"],
            ["neha_j", "my brother got a message like that on a game once"],
            ["aisha_r", "did he tell your mum?"],
            ["neha_j", "yes she reported it"],
        ],
    },
]

# ---------------------------------------------------------------- template generator
# Two DISJOINT phrase pools. Pool A builds the synthetic *training* set used for domain
# adaptation; pool B builds the *evaluation* set. No phrase, topic or handle stem is shared,
# so a model can only score well on pool B by generalising the behaviour, not by memorising
# templates.
POOLS = {
    "A": {
        "adult": ["coach_", "mentor_", "jay_", "rk_", "cool_guy", "nightowl"],
        "kid": ["sara", "anu", "riya", "kiran", "meena"],
        "filler": ["lol", "ok", "haha", "yeah", "cool", "what are you doing", "nothing much", "brb"],
        "benign": [
            ["did you finish the homework", "not yet, chapter 4 is long", "lets do it together tmrw", "ok after class"],
            ["are you watching the match", "yes!! that goal", "best game this season", "final is next week"],
            ["mum says dinner at 8", "ok coming", "can you bring bread on the way", "sure"],
            ["new level is out", "i know im stuck on the boss", "use the shield", "omg it worked"],
        ],
        "adult_date": [
            ["had fun at dinner", "me too, you're sweet", "coffee on saturday?", "sure, the usual place"],
        ],
        "groom": {
            "age_probe": ["how old are you", "what grade are you in"],
            "flattery": ["you're really cute", "you seem so mature for your age"],
            "secrecy": ["don't tell your parents about me", "this is our secret ok"],
            "isolation": ["are you home alone", "your parents don't understand you"],
            "platform_migration": ["add me on snap", "whats your phone number"],
            "image_request": ["send me a pic", "send a photo of you"],
            "meeting": ["i could pick you up after school", "we should meet up"],
        },
        "kid_replies": ["ok", "idk", "why", "i guess", "im 13", "my mom is home"],
        "openers": ["hey", "hi there"],
    },
    "B": {
        "adult": ["photo_pro", "music_man", "sk8_", "gamer_", "drift_", "tutor_"],
        "kid": ["joel", "tina", "rahul", "neha", "dia"],
        "filler": ["hmm", "true", "same", "so bored", "nice", "really?", "omg", "wait what"],
        "benign": [
            ["meeting moved to 3pm", "noted, will send the slides", "thanks, also book the room", "done"],
            ["happy birthday!!", "thank youuu", "party on sunday?", "yes at my place, 5pm"],
            ["bus is late again", "ugh same here", "walking instead?", "yeah meet at the corner"],
            ["can i borrow your charger", "its in my bag", "thanks will return at lunch", "no rush"],
        ],
        "adult_date": [
            ["you looked great today", "haha thanks", "want to meet after work", "yes, 7pm works"],
        ],
        "groom": {
            "age_probe": ["which school do you go to", "asl?", "what class are you in now"],
            "flattery": ["you're prettier than girls my age", "you're special, not like the others"],
            "secrecy": ["delete this chat after", "keep this between us", "nobody needs to know about us"],
            "isolation": ["only i understand you", "are your parents around", "is anyone else at your place"],
            "platform_migration": ["lets talk on another app", "text me on whatsapp instead", "add me on telegram"],
            "image_request": ["show me what you look like", "what are you wearing right now"],
            "meeting": ["where do you live", "come over this weekend", "i can drive to your area"],
        },
        "kid_replies": ["maybe", "14", "ok i wont tell", "is that ok?", "i have school", "haha"],
        "openers": ["hey whats up", "nice profile"],
    },
}


def gen_benign(rng, pool, k):
    P = POOLS[pool]
    a, b = rng.choice(P["kid"]) + str(rng.randint(1, 99)), rng.choice(P["kid"]) + "_" + str(rng.randint(1, 99))
    lines = rng.choice(P["benign"] if k % 4 else P["adult_date"])
    msgs = []
    for i, line in enumerate(lines):
        msgs.append([a if i % 2 == 0 else b, line])
        if rng.random() < 0.6:
            msgs.append([rng.choice([a, b]), rng.choice(P["filler"])])
    return {"messages": msgs, "label": 0, "predator": None}


def gen_groom(rng, pool):
    P = POOLS[pool]
    adult, kid = rng.choice(P["adult"]) + str(rng.randint(10, 99)), rng.choice(P["kid"]) + str(rng.randint(1, 99))
    fams = rng.sample(list(P["groom"]), rng.randint(3, 6))
    msgs = [[adult, rng.choice(P["openers"])], [kid, rng.choice(["hi", "hey"])]]
    for fam in fams:
        msgs.append([adult, rng.choice(P["groom"][fam])])
        if rng.random() < 0.7:
            msgs.append([kid, rng.choice(P["kid_replies"])])
        if rng.random() < 0.4:
            msgs.append([adult, rng.choice(P["filler"])])
    return {"messages": msgs, "label": 1, "predator": adult}


def build(pool, n_benign, n_groom, seed, prefix):
    rng = random.Random(seed)
    convs = [gen_benign(rng, pool, k) for k in range(n_benign)] + [gen_groom(rng, pool) for _ in range(n_groom)]
    rng.shuffle(convs)
    for i, c in enumerate(convs):
        c["id"] = f"{prefix}-{i:04d}"
    return convs


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "samples.json").write_text(json.dumps(SAMPLES, indent=2))

    train = build("A", 900, 300, seed=11, prefix="SYNA")
    evals = build("B", 450, 150, seed=7, prefix="SYNB")
    (OUT / "synthetic_train.json").write_text(json.dumps({
        "description": "Pool A — synthetic training chats for domain adaptation (non-explicit).",
        "conversations": train}, indent=1))
    (OUT / "synthetic_eval.json").write_text(json.dumps({
        "description": "Pool B — synthetic evaluation chats written from phrase templates disjoint from pool A. "
                       "150 grooming-pattern, 450 benign (incl. adult-dating hard negatives).",
        "conversations": evals}, indent=1))
    print(f"samples: {len(SAMPLES)}   train(A): {len(train)} ({sum(c['label'] for c in train)} pos)   "
          f"eval(B): {len(evals)} ({sum(c['label'] for c in evals)} pos)")


if __name__ == "__main__":
    main()
