# ACPIA — Agentic Child Protection Investigation Assistant (with ML)

This is the ACPIA investigation console (HacKP 2026 · Kerala Police Cyberdome) with a
**machine-learning layer integrated into it**. The application, its UI and its design are ACPIA's,
unchanged; the original app README is kept as [ACPIA_APP_README.md](ACPIA_APP_README.md).

What the ML integration adds:

| Where in ACPIA | What it shows |
|---|---|
| **Case → ML analysis** (sidebar, *Case intelligence*) | The trained models run over the case's own conversation threads: thread score, per-participant score, ranked instigator, behaviour signals, the n-grams behind each score, “Open in timeline” click-through, and a comparison of all 9 models against the demo case's answer key |
| **Model performance** (sidebar, *Machine learning*) | Accuracy, precision, recall, F1, F0.5, ROC-AUC, PR-AUC, calibration, PR/ROC curves, confusion matrix, threshold slider — on the official PAN 2012 test set — plus a transfer test on modern-style chats |
| **Datasets & statistics** (sidebar, *Machine learning*) | PAN12 benchmark, synthetic data, NCRB cyber crimes against children (India / Kerala / states, k-means clusters), NCMEC CyberTipline reports for India, image-hashing robustness |

Like the rest of ACPIA, the ML layer proposes and never decides: it writes nothing to the case, and
an ML score is a lead for an officer to review, never a finding.

---

## Results

Official **PAN 2012 Sexual Predator Identification** test set — 218,702 users, 254 predators.
Full tables: [results/RESULTS.md](results/RESULTS.md).

| Model | Accuracy (predator vs victim) | Balanced Acc. | Precision | Recall | F1 | **F0.5** | ROC-AUC |
|---|---|---|---|---|---|---|---|
| DistilBERT (fine-tuned) | 0.912 | 0.831 | 0.966 | 0.661 | 0.785 | **0.884** | 0.933 |
| Ensemble (DistilBERT + TF-IDF LR) | 0.919 | 0.807 | 0.912 | 0.614 | 0.734 | 0.832 | 0.899 |
| TF-IDF + Complement Naive Bayes | 0.920 | 0.801 | 0.905 | 0.602 | 0.723 | 0.823 | 0.975 |
| TF-IDF + Complement NB (PAN12 + synthetic) | 0.900 | 0.781 | 0.888 | 0.563 | 0.689 | 0.796 | 0.976 |
| Char n-gram TF-IDF + Logistic Regression | **0.921** | 0.754 | 0.915 | 0.508 | 0.653 | 0.788 | 0.793 |
| TF-IDF + Logistic Regression (PAN12 + synthetic) | 0.913 | 0.789 | 0.855 | 0.579 | 0.690 | 0.780 | 0.858 |
| TF-IDF + Logistic Regression | 0.912 | 0.746 | 0.912 | 0.492 | 0.639 | 0.779 | 0.823 |
| TF-IDF + Linear SVM (calibrated) | 0.911 | 0.758 | 0.868 | 0.516 | 0.647 | 0.763 | 0.821 |
| Behavioural signals + Gradient Boosting | 0.814 | 0.659 | 0.779 | 0.319 | 0.453 | 0.605 | 0.764 |
| *Baseline: flag nobody* | *—* | *0.500* | *—* | *0.000* | *0.000* | *0.000* | *0.500* |

**How to read accuracy:** *Accuracy (predator vs victim)* is the stage-2 accuracy on 5,624 participants of predator conversations in the official PAN12 test set — given a suspicious chat, how often the model correctly tells the predator from the victim. Raw person-level accuracy is not shown: 99.88% of users are not predators, so even a model that flags nobody scores 0.9988, which says nothing. **Balanced accuracy** (average of the predator and non-predator detection rates) is the fair overall figure. F0.5 is the official PAN12 metric; the best published PAN 2012 system scored about 0.93.

**On the ACPIA demo case** (“Op Riverbank”, with its answer key in `data/case_manifest.json`):
all 9 models rank the real offender, `swim_coach_rk`, first. Most also flag innocent people at the
0.5 triage threshold — typically Aisha's mother, whose ordinary family chat is full of the
“leaving at 6 / pick you up” logistics PAN12 associates with grooming. Only the calibrated SVM and
the domain-adapted logistic regression flag nobody else.

**Domain shift.** On 600 synthetic modern-style chats written from templates no model saw:
conversation-level detection falls to roughly chance (ROC-AUC 0.44–0.51 for PAN12-only models; word
Naive Bayes inverted at 0.10; character n-grams 0.82), while identifying the instigator inside a chat
holds at 94–100%. That is why ACPIA's ML view leads with the ranked instigator and warns about the
thread score. Re-validation on sanitised Kerala case data (Malayalam / Manglish) is required before any
operational use.

---

## Run it

Requirements: Python 3.12, Node 20+, optionally an NVIDIA GPU (CUDA 12.4) for DistilBERT.

```bash
# 1. Python environment (backend + ML)
python -m venv .venv
.venv\Scripts\python -m pip install torch==2.6.0 --index-url https://download.pytorch.org/whl/cu124
.venv\Scripts\python -m pip install -r requirements.txt

# 2. Backend  (http://localhost:8002) — auto-seeds the "Op Riverbank" demo case on start
cd backend
copy .env.example .env          # optional: add a GROQ_API_KEY for the AI-triage agent
..\.venv\Scripts\python -m uvicorn main:app --port 8002

# 3. Frontend (http://localhost:3002) — in a second terminal
cd frontend
echo BACKEND_URL=http://localhost:8002 > .env.local
npm install
npm run dev -- -p 3002
```

Open a case, then choose **ML analysis** in the sidebar. **Model performance** and **Datasets &
statistics** work without a case. The first DistilBERT request loads the model (a few seconds).

The ports are 8002/3002 so this project can run alongside the original ACPIA app (8000/3000). To use
8000/3000 instead, drop the port flags and the `.env.local` file.

If `data/case_bundle/` is missing (it is git-ignored), regenerate it with
`python data/generate_case.py`.

## Reproduce the ML

```bash
cd ml
..\.venv\Scripts\python download_data.py --pan12   # government data + PAN12 (~91 MB)
..\.venv\Scripts\python prepare_data.py            # PAN12 XML -> data/processed/*.pkl
..\.venv\Scripts\python make_synthetic.py          # synthetic chats (pools A/B)
..\.venv\Scripts\python train_classical.py         # 7 CPU models, ~10 min incl. evaluation
..\.venv\Scripts\python train_distilbert.py        # optional re-fine-tune, ~18 min on an RTX 3050
..\.venv\Scripts\python eval_distilbert.py         # DistilBERT + ensemble evaluation, ~13 min on GPU
..\.venv\Scripts\python eval_synthetic.py          # transfer test for every model
..\.venv\Scripts\python hashing_experiment.py      # hashing robustness, ~40 s
..\.venv\Scripts\python gov_data.py                # NCRB + NCMEC -> data/gov/gov_stats.json
..\.venv\Scripts\python dataset_stats.py           # PAN12 counts for the Datasets page
..\.venv\Scripts\python report.py                  # results/RESULTS.md
```

The DistilBERT weights were fine-tuned in the earlier `pep-Delfi` project with the same script;
`eval_distilbert.py` re-scores them and reproduces the original author-level precision, recall, F0.5
and ROC-AUC exactly.

---

## How the integration works

```
frontend/ (Next.js, ACPIA)                     backend/ (FastAPI, ACPIA)
  components/ml/MLAnalysisView.tsx   ─┐          main.py  ── app.include_router(ml_service.router)
  components/ml/ModelPerformanceView.tsx ├─ /api/ml/*, /api/cases/[id]/ml*  ──►  ml_service.py
  components/ml/DatasetsView.tsx     ─┘   (proxy routes, same pattern            │  loads models/*.joblib
  app/models, app/datasets (pages)          as every ACPIA route)                │  + DistilBERT (lazy)
                                                                                 │  reads results/*.json,
                                                                                 ▼  data/gov/gov_stats.json
ml/  training & evaluation scripts  ──►  models/  results/  data/gov/  data/synthetic/
```

`backend/ml_service.py` groups a case's messages into threads between **identity-resolved** actors
(using ACPIA's own `identity.py`, so the same person across WhatsApp and Instagram is one participant),
then runs the same two-stage pipeline the models were trained with:

1. **Thread score** (stage 1) — does this conversation look like grooming?
2. **Participant score** (stage 2) — which side is driving it: the instigator or the person receiving it?

A participant is flagged when stage 1 ≥ t1 and stage 2 ≥ t2. Two modes are shown: **tuned** (the
benchmark thresholds, very strict) and **triage** (0.5).

Changes to existing ACPIA files are limited to wiring:

| File | Change |
|---|---|
| `backend/main.py` | import `ml_service` and `app.include_router(...)` (2 lines) |
| `frontend/src/lib/caseViews.ts` | add the `ml` case view |
| `frontend/src/components/shell/Sidebar.tsx` | icon for `ml`; a *Machine learning* nav group |
| `frontend/src/app/cases/[caseId]/page.tsx` | render `MLAnalysisView` for `view=ml` |

Everything else is new files built from ACPIA's existing components, tokens and layout patterns.

### API

| Method | Path | Returns |
|---|---|---|
| GET | `/cases/{id}/ml?model=char_lr` | Threads, participant scores, ranked instigator, signals, top n-grams |
| GET | `/cases/{id}/ml/compare` | All models on the case (+ answer-key scoring for the demo bundle) |
| GET | `/ml/models`, `/ml/models/{id}` | Metric summaries / full results with curves and calibration |
| GET | `/ml/datasets`, `/ml/gov`, `/ml/hashing` | Dataset statistics, government data, hashing experiment |

### Models

| id | Model |
|---|---|
| `distilbert` | DistilBERT fine-tuned, 256 tokens (head + tail), GPU |
| `ensemble` | Mean of DistilBERT and TF-IDF LR probabilities |
| `tfidf_lr` | Word 1–2-gram TF-IDF + Logistic Regression |
| `tfidf_svm` | TF-IDF + Linear SVM, sigmoid-calibrated (research paper ACPIA_07) |
| `tfidf_cnb` | TF-IDF + Complement Naive Bayes |
| `char_lr` | Character 2–5-gram TF-IDF + Logistic Regression — default in ACPIA (best transfer) |
| `behavioral_hgb` | 29 interpretable behaviour features (`ml/ml_signals.py`) + Histogram Gradient Boosting |
| `*_aug` | Same recipes trained on PAN12 + synthetic pool A (domain adaptation) |

## Data

| Dataset | Used for | Source |
|---|---|---|
| PAN 2012 Sexual Predator Identification — real chats, predators talking to **adult decoys** | Training / evaluation | [Zenodo](https://zenodo.org/records/3713280) |
| NCRB Crime in India, Table 9A.11 (2017–2021) | Datasets page | [Mendeley (CC BY)](https://data.mendeley.com/datasets/mc7wsp8v9y/2) · [ncrb.gov.in](https://ncrb.gov.in) |
| NCMEC CyberTipline reports by country (2019–2024) | Datasets page | [missingkids.org](https://www.missingkids.org/gethelpnow/cybertipline/cybertiplinedata) |
| Synthetic chats (pool A 1,200 / pool B 600) | Domain adaptation / transfer test | `ml/make_synthetic.py` |
| Synthetic images (400) | Hashing experiment | `ml/hashing_experiment.py` |
| ACPIA demo case bundle | The case the console opens on | `data/generate_case.py` |

PAN12 contains sexually explicit text. It is git-ignored and never printed or served — the API returns
only counts and metrics. More on what exists publicly: [datasets/README.md](datasets/README.md).

## Limitations

- PAN12 predators were talking to adult decoys, in English, in the 2000s. The transfer test and the
  demo-case false flags show the models do not carry over to modern or Indian chats without retraining.
- Threshold tuning rests on 27 validation predators; differences of ~0.02 F0.5 are within noise.
- Synthetic data is template-generated and narrow.
- Six TypeScript errors in ACPIA's own `EvidenceMap.tsx` and `ResultsTimeline.tsx` predate this work
  (the original app has the same six); `next dev` runs normally.
- These models rank material for human review. They do not determine guilt.
