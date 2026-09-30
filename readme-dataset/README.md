# Datasets for ACPIA — what exists, what doesn't, and what to use

Research notes on public data relevant to **ACPIA (Agentic Child Protection Investigation Assistant)**. Compiled September 2026. Links were checked at the time of writing; access terms can change.

## The short answer

Real case evidence is not publicly available, and never will be. No one publishes actual seized-phone extractions, real victim chats, child sexual abuse material, or the known-CSAM hash lists (NCMEC, INTERPOL ICSE, Project VIC, UK CAID). Those are shared only with law enforcement under legal agreements.

The legitimate route to real data is the hackathon host — **Kerala Police Cyberdome** — under a formal data-sharing agreement.

What does exist publicly falls into four groups below. Items marked ⭐ are the ones worth using for ACPIA.

---

## 1. Grooming-conversation text datasets

Closest match to ACPIA's signals / triage engine.

| Dataset | What it is | Access |
|---|---|---|
| ⭐ **PAN 2012 Sexual Predator Identification** | ~67,000 chat conversations, 97,000+ users, 142 labelled predators. Predator chats are between convicted offenders and adult decoys posing as minors — no real child victims. Text only. The standard academic benchmark. | Zenodo download (91 MB zip) · Task page |
| **PANC** (Vogt et al., ACL 2021) | Built from PAN12 + ChatCoder2 for early sexual-predator detection — flagging grooming while a chat is still in progress. This is exactly ACPIA's triage question. | Paper · Papers with Code |
| **Early detection of online grooming** | Grooming-detection dataset hosted on IEEE DataPort. | IEEE DataPort (login may be required) |
| **Perverted-Justice chat logs** | 614 offender ↔ decoy transcripts. No longer public — the Aston University archive requires a detailed application and approval. | Aston archive |

> **Handling note:** these texts are sexually explicit even though no real child was involved. Treat them as sensitive research data. Keep them out of the git repository (add the folder to `.gitignore`), and do not display raw lines on screen during the pitch.

---

## 2. Government and official statistics

For the problem-statement slide and for grounding claims in the pitch.

- ⭐ **NCRB — "Crime in India"** (National Crime Records Bureau, Government of India). Official POCSO and cyber-crimes-against-children tables. 2022: **1,823 cyber crimes against children, a 32% rise over 2021.**
  - ncrb.gov.in
  - data.gov.in — State/UT-wise age profile of POCSO child victims, 2021
  - Dataful mirror of NCRB tables
  - Deccan Herald summary of the 2022 figures
- ⭐ **NCMEC CyberTipline — reports by country.** 36.2 million+ reports worldwide in 2023, broken down by country (India included).
  - 2023 reports by country (PDF)
  - CyberTipline data page
- **IWF Annual Data & Insights Report 2024** (Internet Watch Foundation, UK). 291,273 reports actioned; documents the rise of AI-generated material — useful support for the synthetic-media detection capability.
  - iwf.org.uk/annual-data-insights-report-2024
- **Kerala POCSO figures.** No official downloadable dataset from Kerala Police was found. Year-wise figures currently available come from news reports citing Kerala Police or the Kerala State Commission for Protection of Child Rights — cite them as "reported", or request official figures from Cyberdome.
  - Onmanorama, Nov 2024

---

## 3. Digital-forensics test data

Realistic device evidence with no abuse content — for testing parsers and ingestion.

- ⭐ **Josh Hickman public phone images** (Android 7–14, iOS 13–17). Complete, documented extractions of test phones with real apps and messaging data. Best available source for testing ACPIA's parsers against genuine WhatsApp / Instagram file formats.
  - Digital Corpora
  - Cellebrite write-up of the images
- **NIST CFReDS — mobile device images.** Reference forensic images for tool validation.
  - cfreds-archive.nist.gov/mobile
- **NIST NSRL — National Software Reference Library.** 40M+ hashes of known-good software files, used to filter system and application files out of an evidence set. This is the legal, public counterpart to ACPIA's known-bad hash gate, and could remove noise such as routine browser and system artefacts.
  - NSRL download

---

## 4. Synthetic / deepfake media detection

Adult faces only.

- **FaceForensics++** — 1,000 original videos, each manipulated with four methods (Deepfakes, Face2Face, FaceSwap, NeuralTextures). Access via a request form.
  - github.com/ondyari/faceforensics
- **Deepfake Detection Challenge (DFDC)** — Meta / AWS dataset.
  - Preview dataset paper

---

## What is NOT available (and why)

| Data | Status |
|---|---|
| Known-CSAM hash lists (NCMEC, INTERPOL ICSE, Project VIC, CAID) | Law enforcement only |
| Microsoft PhotoDNA | Licensed to vetted organisations only |
| Real seized device extractions from child-protection cases | Never published |
| Real victim communications | Never published |
| Child sexual abuse imagery | Illegal to possess or distribute — no dataset exists or should |

---

## Recommended plan for the hackathon

1. **Keep the synthetic generator** (`data/generate_case.py`) as the demo case. It is safe, fully controlled, and judges can see that nothing real is shown.
2. **Add PAN12 as a validation benchmark.** Run `signals.py` + echo suppression over it and report precision / recall against the 142 labelled predators. "Validated on the standard academic benchmark" is far stronger than "works on data we generated ourselves."
3. **Use NCRB and NCMEC India figures** on the problem slide, with citations.
4. **Ask Cyberdome** what anonymised or sanitised data could be shared for a controlled pilot — this is the honest answer when judges ask about real-world data.

---

## Sources

- PAN12 on Zenodo
- PAN12 task page
- PANC — ACL 2021 paper
- PANC — Papers with Code
- IEEE DataPort — early detection of online grooming
- Aston University — Perverted-Justice archive
- data.gov.in — POCSO age profile 2021
- Dataful — NCRB dataset
- Deccan Herald — NCRB 2022 cyber crimes against children
- NCMEC — 2023 reports by country
- NCMEC — CyberTipline data
- IWF — 2024 data report
- Onmanorama — Kerala POCSO
- Digital Corpora
- Cellebrite — Hickman images
- NIST CFReDS — mobile
- NIST NSRL
- FaceForensics++
- DFDC preview paper
