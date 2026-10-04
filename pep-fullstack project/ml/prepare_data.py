"""Parse the PAN12 Sexual Predator Identification XML into compact pickles.

Output (data/processed/):
  train.pkl / test.pkl  -> list of conversations:
      {"id": str, "messages": [(author, text), ...], "predators": [author ids in this conv]}
  plus author-level ground truth sets.

Raw chat text is never printed; only counts.
"""
import pickle
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "pan12"
OUT = ROOT / "data" / "processed"

TRAIN_DIR = RAW / "pan12-sexual-predator-identification-training-corpus-2012-05-01"
TEST_DIR = RAW / "pan12-sexual-predator-identification-test-corpus-2012-05-21"

TRAIN_XML = TRAIN_DIR / "pan12-sexual-predator-identification-training-corpus-2012-05-01.xml"
TRAIN_PRED = TRAIN_DIR / "pan12-sexual-predator-identification-training-corpus-predators-2012-05-01.txt"
TEST_XML = TEST_DIR / "pan12-sexual-predator-identification-test-corpus-2012-05-17.xml"
TEST_PRED = TEST_DIR / "pan12-sexual-predator-identification-groundtruth-problem1.txt"


def read_ids(path):
    return {line.strip() for line in path.read_text().splitlines() if line.strip()}


def parse(xml_path, predators):
    convs = []
    for _, elem in ET.iterparse(xml_path, events=("end",)):
        if elem.tag != "conversation":
            continue
        msgs = []
        for m in elem.findall("message"):
            author = (m.findtext("author") or "").strip()
            text = (m.findtext("text") or "").strip()
            msgs.append((author, text))
        authors = {a for a, _ in msgs}
        convs.append({
            "id": elem.get("id"),
            "messages": msgs,
            "predators": sorted(authors & predators),
        })
        elem.clear()
    return convs


def summary(name, convs, predators):
    authors = {a for c in convs for a, _ in c["messages"]}
    pos = [c for c in convs if c["predators"]]
    two = sum(1 for c in pos if len({a for a, _ in c["messages"]}) == 2)
    print(f"[{name}] conversations={len(convs):,}  with predator={len(pos):,} "
          f"(2-author: {two:,})  authors={len(authors):,}  predators present={len(authors & predators)}")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, xml, pred_file in [("train", TRAIN_XML, TRAIN_PRED), ("test", TEST_XML, TEST_PRED)]:
        predators = read_ids(pred_file)
        convs = parse(xml, predators)
        summary(name, convs, predators)
        with open(OUT / f"{name}.pkl", "wb") as f:
            pickle.dump({"conversations": convs, "predators": predators}, f)
    print(f"saved to {OUT}")


if __name__ == "__main__":
    main()
