# Authoritative Reference Sources

Every external fact, threshold, constant, dataset or simulation parameter used in ARGUS has a stable ID here.

How to use this file (see `AGENTS.md` §7):
- **Cite by ID** where the source is used:
  - in code: `// Source: SRC-007 (NASA-STD-3001 Vol 1 Rev C §4.8)`;
  - in specs: `[SRC-007]`;
  - in DB rows: `source_id = 'SRC-007'`.
- **Keep "Used in" current.** When you start or stop using a source, update its "Used in" cell with the file, spec section or DB table.
- **Add new sources at the end.** Never renumber, so IDs stay stable. Mark retired sources `(retired)` instead of deleting them.
- `npm run check:sources` fails on a cited ID that is missing here, and lists sources with an empty "Used in" cell.

Columns:
- **Type:** `web` · `paper` · `dataset` · `standard` · `api`.
- **Access:** `open` (downloadable now) · `request` (approval needed) · `restricted`.

---

## NASA Human Research Program & health standards

| ID | Source | Type | Access | Used in |
|---|---|---|---|---|
| SRC-001 | [5 Hazards of Human Spaceflight](https://www.nasa.gov/hrp/hazards/) (NASA HRP) | web | open | `specs/01-data-schema.md` §1 (zones and hazards), `src/data/telemetryScenarios.ts` (`BODY_ZONES`) |
| SRC-002 | [Risks of Human Spaceflight](https://www.nasa.gov/hrp/risks/) (NASA HRP) | web | open | `server/models/diagnosticsRules.ts` (HRP risk candidates) |
| SRC-003 | [Ongoing HRP Research in Space](https://www.nasa.gov/hrp/ongoing-hrp-research/) | web | open | `specs/05-data-platform.md` §4 (sensor kit context) |
| SRC-004 | [Exploration Medical Condition List, NTRS 20110008645](https://ntrs.nasa.gov/api/citations/20110008645/downloads/20110008645.pdf) (Watkins, Barr & Kerstman, 2011) | paper | open | `server/rag/emergencyProtocols.ts`, `server/models/diagnosticsRules.ts`, `server/rag/corpus.ts` (`rag_documents` `emergency/*`), `server/rag/corpus/spaceflight-med-kit-formulary.md` |
| SRC-005 | [NASA Life Sciences Portal: Experiments Explorer](https://nlsp.nasa.gov/explore?dataType=EXPERIMENTS) (NLSP / LSDA) | dataset | request | `specs/05-data-platform.md` §7 (why per-astronaut data must be simulated) |
| SRC-006 | [Lifetime Surveillance of Astronaut Health (LSAH)](https://nlsp.nasa.gov/resources/lsah) | dataset | restricted | `specs/01-data-schema.md` §1–§2, `specs/05-data-platform.md` §7, `src/utils/triageEngine.ts` |
| SRC-007 | [NASA-STD-3001 Vol 1 Rev C: Crew Health](https://standards.nasa.gov/sites/default/files/standards/NASA/C//nasa-std-3001-vol-1-rev-c-signature.pdf) (2023) | standard | open | `specs/05-data-platform.md` §7 (source for further limits; each must be checked against the PDF before it is added to `data/reference/thresholds.csv`), `server/rag/corpus/hypercapnia-co2-exposure.md` |
| SRC-008 | [OCHMO Radiation Protection Technical Brief](https://www.nasa.gov/wp-content/uploads/2023/03/radiation-protection-technical-brief-ochmo.pdf) (600 mSv career limit) | standard | open | `data/reference/thresholds.csv`, `ref_thresholds`, `analysis/notebooks/01_radiation_reference.ipynb`, `server/rag/corpus/radiation-alara-protection.md` |
| SRC-009 | [Spaceflight Standard Measures](https://www.nasa.gov/humans-in-space/spaceflight-standard-measures-characterizing-how-humans-adapt-in-space) (NASA) | web | open | `specs/01-data-schema.md` §1–§2, `specs/05-data-platform.md` §4 (sensor kit: actigraphy, surveys, cognition), `src/utils/triageEngine.ts` |
| SRC-010 | [HRP Evidence Reports / Human Research Roadmap](https://humanresearchroadmap.nasa.gov/evidence/) | paper | open | `specs/05-data-platform.md` §3.6 & §8 (AI context & RAG corpus), `server/rag/corpus/sans-neuro-ocular.md` |

## Wearables and passive monitoring flown in space

| ID | Source | Type | Access | Used in |
|---|---|---|---|---|
| SRC-020 | [CSA Bio-Monitor / Astroskin](https://www.asc-csa.gc.ca/eng/sciences/bio-monitor.asp) (Canadian Space Agency) | web | open | `specs/05-data-platform.md` §4 (flown precedent for continuous vitals; the shirt itself was replaced by the smartwatch), `src/features/thousandEyes/indicators.ts` (sensor ring: ecg) |
| SRC-021 | [Astroskin sensor sampling rates](https://support.hexoskin.com/en/astroskin/what-is-the-sampling-rate-for-the-astroskin-sensors) (Hexoskin) | web | open | `specs/05-data-platform.md` §4 (precedent: 1 Hz vitals on a wearable) |
| SRC-022 | [Bio-Monitor validation, NTRS 20190000238](https://ntrs.nasa.gov/api/citations/20190000238/downloads/20190000238.pdf) | paper | open | `specs/05-data-platform.md` §4, `src/features/thousandEyes/indicators.ts` (sensor ring: ecg) |
| SRC-023 | [Actigraphy in spaceflight, NTRS 20200001281](https://ntrs.nasa.gov/api/citations/20200001281/downloads/20200001281.pdf) (Actiwatch Spectrum) | paper | open | `specs/05-data-platform.md` §4 (wrist actigraphy → watch sleep/activity), `server/ingest/simulator.ts` (sleep blocks) |
| SRC-024 | [Artemis II crew research (ARCHeR)](https://www.nasa.gov/humans-in-space/artemis-ii-crew-to-advance-human-spaceflight-research/) (NASA) | web | open | `specs/05-data-platform.md` §4, §5.2 (crew wear the actigraph ~6 months before flight → Earth pre-flight baseline), `server/ingest/simulator.ts` |
| SRC-025 | [ESA "Keeping the rhythm in space"](https://www.esa.int/Science_Exploration/Human_and_Robotic_Exploration/Research/Keeping_the_rhythm_in_space) (Circadian Rhythms, Double Sensor core temperature) | web | open | `server/ingest/simulator.ts` (~2 h circadian shift, body-temperature rise) |
| SRC-026 | [ISS Crew Active Dosimeter](https://read.qxmd.com/read/37945094/the-importance-of-time-resolved-personal-dosimetry-in-space-the-iss-crew-active-dosimeter) (Gaza et al., 2023) | paper | open | `specs/05-data-platform.md` §4, `server/db/catalog.ts`, `server/ingest/simulator.ts` (dosimeter, the 2nd worn device) |
| SRC-027 | [Inspiration4 wearables (Apple Watch)](https://pmc.ncbi.nlm.nih.gov/articles/PMC11357997) | paper | open | `specs/05-data-platform.md` §4, `server/db/catalog.ts` (smartwatch flown on Inspiration4) |
| SRC-028 | [Polaris Dawn health research data collection](https://trialx.com/supporting-health-research-data-collection-for-the-polaris-dawn-commercial-space-mission) (Garmin, Dexcom, TRISH EXPAND) | web | open | `specs/05-data-platform.md` §4 (Garmin watch and a Dexcom CGM flown on Polaris Dawn; CGM considered, not adopted), `src/features/thousandEyes/indicators.ts` (sensor ring: glu) |
| SRC-029 | [Ax-4 ISS edge computing for crew readiness](https://axiomspace.com/research/iss-edge-computing-for-crew-readiness-demonstration) (Oura ring) | web | open | `specs/05-data-platform.md` §4, `server/ingest/simulator.ts` (nightly HRV and resting HR, now from the watch) |

## Radiation and open datasets

| ID | Source | Type | Access | Used in |
|---|---|---|---|---|
| SRC-040 | [Monitoring Radiation for Astronaut Health](https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp) (CSA) | web | open | `specs/05-data-platform.md` §4 (dosimetry context) |
| SRC-041 | [Why Do We Conduct Science Experiments in Space?](https://www.asc-csa.gc.ca/eng/iss/science/why-do-we-conduct-science-experiments-in-space.asp) (CSA) | web | open | `README.md` (project context) |
| SRC-042 | [DOSIS 3D: ISS Columbus dose rates](https://www.swsc-journal.org/articles/swsc/abs/2017/01/swsc160046/swsc160046.html) (Berger et al., SWSC 2017) | paper | open | `data/reference/radiation_dose_rates.csv`, `ref_radiation_dose_rates`, `analysis/notebooks/01_radiation_reference.ipynb` |
| SRC-043 | [Curiosity MSL RAD data (ISWA/CDAWeb)](https://iswa.gsfc.nasa.gov/iswa_data_tree/information/MSLRAD.html) | dataset | open | `specs/05-data-platform.md` §7 (raw MSL RAD archive; daily rates currently taken from SRC-044/045) |
| SRC-044 | [Zeitlin et al. 2013, Science: radiation during Mars cruise (MSL RAD)](https://www.science.org/doi/10.1126/science.1235989) | paper | open | `data/reference/radiation_dose_rates.csv` (1.84 mSv/day cruise), `analysis/notebooks/01_radiation_reference.ipynb` |
| SRC-045 | [Hassler et al. 2014, Science: Mars surface radiation (MSL RAD)](https://www.science.org/doi/10.1126/science.1244797) | paper | open | `data/reference/radiation_dose_rates.csv` (0.64 mSv/day surface), `analysis/notebooks/01_radiation_reference.ipynb` |
| SRC-046 | [NASA OSDR Biological Data API](https://visualization.osdr.nasa.gov/biodata/api) | api | open | `scripts/ingest/osdr.ts`, `ref_osdr_studies` |
| SRC-047 | [Inspiration4 datasets on OSDR (OSD-569…575)](https://www.nasa.gov/osdr-latest-news-i4-mission-datasets/) | dataset | open | `scripts/ingest/osdr.ts`, `ref_osdr_studies`, `ref_osdr_lab_values` (OSD-569 CBC), `analysis/notebooks/02_inspiration4_cbc.ipynb` |
| SRC-048 | [SOMA: Space Omics and Medical Atlas](https://soma.weill.cornell.edu) | dataset | open | `specs/05-data-platform.md` §7 (context only) |
| SRC-049 | [OSDR FAQ: data access levels](https://science.nasa.gov/reference/osdr-faq) | web | open | `specs/05-data-platform.md` §7 |

## Software and security practice

| ID | Source | Type | Access | Used in |
|---|---|---|---|---|
| SRC-060 | [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) (argon2id parameters) | standard | open | `server/auth/passwords.ts` |
| SRC-061 | [Azure PostgreSQL Flexible Server on the free account](https://learn.microsoft.com/azure/postgresql/flexible-server/how-to-deploy-on-azure-free-account) | web | open | `scripts/azure/provision.sh`, `docs/DATABASE.md` |
| SRC-062 | [Azure PostgreSQL extensions by engine version](https://learn.microsoft.com/azure/postgresql/extensions/concepts-extensions-by-engine) | web | open | `specs/05-data-platform.md` §2, `scripts/azure/provision.sh` |
| SRC-063 | [Robust z-score with MAD (Iglewicz & Hoaglin, NIST e-Handbook 1.3.5.17)](https://www.itl.nist.gov/div898/handbook/eda/section3/eda35h.htm) | standard | open | `shared/analytics/detectors.ts` (robust z), `server/jobs/analytics.ts`, `src/features/cognition/scoring.ts` (decline z) |
| SRC-064 | [EWMA and CUSUM control charts (NIST e-Handbook 6.3.2)](https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc32.htm) | standard | open | `shared/analytics/detectors.ts` (EWMA, CUSUM), `server/jobs/analytics.ts`, `src/features/cognition/scoring.ts` (2σ caution band) |

## Smartwatch capabilities and clinical thresholds (challenge core indicators)

| ID | Source | Type | Access | Used in |
|---|---|---|---|---|
| SRC-070 | [AHA: Understanding Blood Pressure Readings](https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings) (2017 ACC/AHA categories) | standard | open | `src/utils/triageEngine.ts` (`bp_sys`, `bp_dia` bands), `specs/01-data-schema.md` §2 |
| SRC-071 | [AHA: Low Blood Pressure](https://www.heart.org/en/health-topics/high-blood-pressure/the-facts-about-high-blood-pressure/low-blood-pressure-when-blood-pressure-is-too-low) (hypotension < 90/60) | standard | open | `src/utils/triageEngine.ts` (`bp_sys`, `bp_dia` lower bands) |
| SRC-072 | [ADA Standards of Care 2023, §2 Classification and Diagnosis](https://diabetesjournals.org/care/article/46/Supplement_1/S19/148056/) (fasting glucose 100–125 / ≥126 mg/dL) | standard | open | `src/utils/triageEngine.ts` (`glucose` bands), `server/db/catalog.ts`, `src/data/cgmMockData.ts`, `specs/01-data-schema.md` §3 |
| SRC-073 | [ADA Standards of Care 2026, §16 Diabetes Care in the Hospital](https://diabetesjournals.org/care/article/49/Supplement_1/S339/163925/16-Diabetes-Care-in-the-Hospital-Standards-of-Care) (hypoglycemia level 1 54–69, level 2 < 54 mg/dL) | standard | open | `src/utils/triageEngine.ts` (`glucose` lower bands), `src/data/cgmMockData.ts`, `specs/01-data-schema.md` §3 |
| SRC-074 | [Apple Watch User Guide: Track your vitals](https://support.apple.com/guide/watch/apd15aa7ed96/watchos) (overnight heart rate, breathing rate, wrist temperature vs baseline, SpO₂, sleep) | web | open | `server/db/catalog.ts`, `server/ingest/simulator.ts` (watch overnight vitals, `wrist_temp_dev`) |
| SRC-075 | [Samsung: Recalibrating Galaxy Watch blood pressure](https://www.samsung.com/uk/support/apps-services/how-do-i-recalibrate-the-galaxy-watch/) (cuff calibration, recalibrate every 28 days) | web | open | `server/db/catalog.ts`, `server/ingest/simulator.ts` (watch blood pressure), `specs/05-data-platform.md` §4 |
| SRC-076 | [FDA: Do not use smartwatches or smart rings to measure blood glucose](https://www.fda.gov/medical-devices/safety-communications/do-not-use-smartwatches-or-smart-rings-measure-blood-glucose-levels-fda-safety-communication) (2024) | standard | open | `specs/05-data-platform.md` §4 (why glucose is not from the watch) |
| SRC-077 | Challenge brief: camera images incl. blood sugar mg/dL as an input modality (`specs/03-requirements.md` §3.2) | web | open | `server/db/catalog.ts` (glucometer photo), `specs/05-data-platform.md` §4 |
| SRC-078 | [SPACEDOS04 personal active dosimeter with wristwatch display](https://docs.dos.ust.cz/spacedos/SPACEDOS04) (in development) | web | open | `specs/05-data-platform.md` §4 (dosimeter could show on the wrist later) |
| SRC-079 | [ESA: Active tracking of astronaut radiation exposures (EuCPAD / ESA Active Dosimeter)](https://www.esa.int/Enabling_Support/Space_Engineering_Technology/Active_tracking_of_astronaut_rad-exposures_targeted) | web | open | `specs/05-data-platform.md` §4 (real-time personal dosimetry) |

## Earth pre-flight baseline

| ID | Source | Type | Access | Used in |
|---|---|---|---|---|
| SRC-080 | [US NRC: Backgrounder on Biological Effects of Radiation](https://www.nrc.gov/reading-rm/doc-collections/fact-sheets/bio-effects-radiation) (natural background ≈ 3.1 mSv/yr in the US) | standard | open | `server/ingest/simulator.ts` (Earth pre-flight `rad_dose`), `specs/05-data-platform.md` §5.2 |
| SRC-081 | [NASA-STD-3001 Vol 2 Rev D: Human Factors, Habitability, and Environmental Health](https://standards.nasa.gov/standard/NASA/NASA-STD-3001-VOL-2) (EER caloric equations, +200 kcal/hr EVA, 2.5 L/day baseline potable water) | standard | open | `specs/01-data-schema.md` §2, `src/utils/triageEngine.ts` (`caloric_intake`, `hydration_intake`), `server/db/catalog.ts` |
| SRC-082 | [NASA HRP Risk of Inadequate Food and Nutrition](https://humanresearchroadmap.nasa.gov/Risks/risk.aspx?i=93) (spaceflight energy balance, flavor fatigue, hypohydration & renal stone risk) | web | open | `specs/01-data-schema.md` §2, `src/utils/triageEngine.ts`, `src/data/telemetryScenarios.ts` |

## AI knowledge base (RAG)

| ID | Source | Type | Access | Used in |
|---|---|---|---|---|
| SRC-083 | [Weinberger et al. 2009, Feature Hashing for Large Scale Multitask Learning](https://arxiv.org/abs/0902.2206) | paper | open | `server/rag/embeddings.ts` (offline `hash` embedder), `specs/05-data-platform.md` §3.6 |
| SRC-084 | [PostgreSQL: Controlling Text Search (`ts_rank_cd`)](https://www.postgresql.org/docs/current/textsearch-controls.html) | standard | open | `server/db/schema.ts` (`rag_chunks.search_tsv`), `server/rag/retriever.ts`, `specs/05-data-platform.md` §3.6 |
| SRC-085 | [Ollama OpenAI compatibility (`/v1/embeddings`)](https://docs.ollama.com/openai) (`nomic-embed-text`) | api | open | `server/rag/embeddings.ts` (`local` embedder), `specs/05-data-platform.md` §3.6 |
| SRC-086 | [Gemini API: Embeddings (`gemini-embedding-001`)](https://ai.google.dev/gemini-api/docs/embeddings) | api | open | `server/rag/embeddings.ts` (`gemini` embedder), `specs/05-data-platform.md` §3.6 |
| SRC-087 | [Robertson & Zaragoza 2009, The Probabilistic Relevance Framework: BM25 and Beyond](https://doi.org/10.1561/1500000019) (k1 = 1.2, b = 0.75) | paper | open | `server/rag/memoryIndex.ts` (BM25), `specs/05-data-platform.md` §3.6 |
| SRC-088 | [Cormack, Clarke & Büttcher 2009, Reciprocal Rank Fusion](https://doi.org/10.1145/1571941.1572114) (k = 60) | paper | open | `server/rag/retriever.ts` (fusion), `specs/05-data-platform.md` §3.6 |

## Cognition testing & crew medical care

| ID | Source | Type | Access | Used in |
|---|---|---|---|---|
| SRC-089 | [Cognition vs WinSCAT validation, NTRS 20180003970](https://ntrs.nasa.gov/api/citations/20180003970/downloads/20180003970.pdf) (the 10 Cognition tests, domains, typical durations) | paper | open | `src/features/cognition/catalog.ts`, `src/features/cognition/games/*`, `specs/01-data-schema.md` §12.1 |
| SRC-090 | [Basner, Mollicone & Dinges 2011: Brief PVT (PVT-B), Acta Astronautica](https://pmc.ncbi.nlm.nih.gov/articles/PMC3197786) (3 min, ISI 1–4 s, lapse ≥ 355 ms) | paper | open | `src/features/cognition/games/Pvt.tsx`, `src/features/cognition/catalog.ts`, `specs/01-data-schema.md` §12.1 |
| SRC-091 | [Basner et al. 2020: practice and stimulus-set effects with repeated Cognition administration](https://pmc.ncbi.nlm.nih.gov/articles/PMC7375457) (learning trend in 6 of 10 tests) | paper | open | `src/features/cognition/scoring.ts` (rolling personal baseline), `specs/01-data-schema.md` §12.3 |
| SRC-092 | [Assessing Crew Medical Officer Preparedness for ISS Missions, NTRS 20230013415](https://ntrs.nasa.gov/citations/20230013415) (CMO as healthcare extender to ground flight surgeons) | paper | open | `src/features/cognition/routing.ts`, `specs/01-data-schema.md` §12.4 |
| SRC-093 | [JAXA: Medical operations system on the ISS](https://humans-in-space.jaxa.jp/en/biz-lab/med-in-space/healthcare/medops/system) (CMO treats with onboard supplies following ground flight-surgeon advice) | web | open | `src/features/cognition/routing.ts`, `specs/01-data-schema.md` §12.4 |
| SRC-094 | [Cognition task descriptions (supplementary table, Research Square preprint rs-8959949)](https://assets-eu.researchsquare.com/files/rs-8959949/v1/49a00054858a43a9120f8546.docx) (MP 20 shrinking squares, VOLT 10 learn/20 test, LOT 12 pairs, AM pairs) | paper | open | `src/features/cognition/games/*` |
| SRC-095 | [Basner et al. 2020: Cognition performance and simulated 6-DOF docking, AMHP 91(11)](https://asma.kglmeridian.com/view/journals/amhp/91/11/article-p861.xml) (DSST best single predictor) | paper | open | `src/features/cognition/games/Dsst.tsx` |

## ARGUS assistant: comm tiers, voice and camera analysis

| ID | Source | Type | Access | Used in |
|---|---|---|---|---|
| SRC-100 | [ITU-T G.114: One-way transmission time](https://www.itu.int/rec/T-REC-G.114) (≤ 400 ms one-way for interactive speech) | standard | open | `shared/commProfile.ts` (`live` tier cut-off) |
| SRC-101 | [Dinges et al., PERCLOS: A Valid Psychophysiological Measure of Alertness (FHWA-MCRT-98-006, 1998)](https://rosap.ntl.bts.gov/view/dot/113) (share of time eyes ≥ 80 % closed) | paper | open | `src/services/vision/signals.ts` (PERCLOS, fatigue levels), `src/types/assistant.ts` |
| SRC-102 | [vladmandic/face-api](https://github.com/vladmandic/face-api) (TinyFaceDetector, 68-point landmarks, 7-class facial expression model, in-browser TensorFlow.js) | software | open | `src/services/vision/observer.ts`, `src/services/vision/signals.ts` (emotion), `src/types/assistant.ts` |
| SRC-103 | [Verkruysse, Svaasand & Nelson, Remote plethysmographic imaging using ambient light, Optics Express 16(26) 2008](https://pmc.ncbi.nlm.nih.gov/articles/PMC2717852) (green channel carries the pulse) | paper | open | `src/services/vision/signals.ts` (`estimatePulse`), `src/services/vision/observer.ts` |
| SRC-104 | [NASA HRP: Risk of Adverse Cognitive or Behavioral Conditions and Psychiatric Disorders](https://www.nasa.gov/directorates/esdmd/hhp/risk-of-adverse-cognitive-or-behavioral-conditions-and-psychiatric-disorders) (isolation and confinement; behavioural-health countermeasures) | web | open | `shared/countermeasures.ts`, `shared/mentalState.ts`, `server/prompts.ts` (`ASSISTANT_PERSONA`) |
| SRC-105 | [Speaches: OpenAI-compatible local speech server](https://speaches.ai/) (faster-whisper STT, Kokoro TTS) | software | open | `server/ai/localSpeech.ts`, `docker-compose.yml` |
| SRC-106 | [Gemini API: Speech generation](https://aistudio.google.com/docs/speech-generation) (30 prebuilt voices and their styles, 24 kHz PCM output) | web | open | `server/ai/geminiVoices.ts`, `server/routes/voice.ts` (`/tts`, `/voices`) |
| SRC-107 | [Soukupová & Čech, Real-Time Eye Blink Detection using Facial Landmarks (CVWW 2016)](https://vision.fe.uni-lj.si/cvww2016/proceedings/papers/05.pdf) (eye aspect ratio) | paper | open | `src/services/vision/signals.ts`, `src/services/vision/observer.ts` |
| SRC-108 | [The distribution of blink rate among young adults: a cross-sectional study (2023)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9899223/) (normal spontaneous blink rate 6–30/min) | paper | open | `src/services/vision/signals.ts` (`blinkRateHigh`) |
| SRC-109 | [Transformers.js](https://huggingface.co/docs/transformers.js) with [Kokoro-82M ONNX](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) (via kokoro-js) and [Whisper base ONNX](https://huggingface.co/onnx-community/whisper-base): in-browser TTS and STT (WebGPU / WebAssembly) | software | open | `src/services/speech/deviceSpeech.worker.ts`, `src/services/speech/deviceSpeech.ts` |
| SRC-110 | [Gao et al. 2016, Fully integrated wearable sensor arrays for multiplexed in situ perspiration analysis, Nature 529:509](https://doi.org/10.1038/nature16521) (sweat glucose, lactate, Na⁺, K⁺) | paper | open | `src/features/thousandEyes/indicators.ts` (sensor ring: glu, lac, na, k), `specs/02-ui-dashboard.md` §2.4b |
| SRC-111 | [Tehrani et al. 2022, An integrated wearable microneedle array for the continuous monitoring of multiple biomarkers in interstitial fluid, Nat Biomed Eng 6:1214](https://doi.org/10.1038/s41551-022-00887-1) | paper | open | `src/features/thousandEyes/indicators.ts` (sensor ring: glu, lac), `specs/02-ui-dashboard.md` §2.4b |
| SRC-112 | [Koh et al. 2016, A soft, wearable microfluidic device for the capture, storage, and colorimetric sensing of sweat, Sci Transl Med 8:366ra165](https://doi.org/10.1126/scitranslmed.aaf2593) (chloride, pH, sweat rate) | paper | open | `src/features/thousandEyes/indicators.ts` (sensor ring: cl, ph, swr), `specs/02-ui-dashboard.md` §2.4b |
| SRC-113 | [Parlak et al. 2018, Molecularly selective nanoporous membrane-based wearable organic electrochemical device for noninvasive cortisol sensing, Sci Adv 4:eaar2904](https://doi.org/10.1126/sciadv.aar2904) | paper | open | `src/features/thousandEyes/indicators.ts` (sensor ring: cort), `specs/02-ui-dashboard.md` §2.4b |
| SRC-114 | [Yang et al. 2020, A laser-engraved wearable sensor for sensitive detection of uric acid and tyrosine in sweat, Nat Biotechnol 38:217](https://doi.org/10.1038/s41587-019-0321-x) | paper | open | `src/features/thousandEyes/indicators.ts` (sensor ring: ua), `specs/02-ui-dashboard.md` §2.4b |
| SRC-115 | [A simple and sensitive wearable SERS sensor utilizing plasmonic-active gold nanostars, ACS Omega 2024](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11411535/) (sweat urea, lactate, glucose) | paper | open | `src/features/thousandEyes/indicators.ts` (sensor ring: urea), `specs/02-ui-dashboard.md` §2.4b |
| SRC-116 | [Yu et al. 2020, Biofuel-powered soft electronic skin with multiplexed and wireless sensing for human-machine interfaces, Sci Robot 5:eaaz7946](https://doi.org/10.1126/scirobotics.aaz7946) (urea, NH₄⁺, glucose, pH) | paper | open | `src/features/thousandEyes/indicators.ts` (sensor ring: urea, nh4, ph), `specs/02-ui-dashboard.md` §2.4b |
| SRC-117 | [Microneedle aptamer-based sensors for continuous, real-time therapeutic drug monitoring, Anal Chem 2022](https://pubmed.ncbi.nlm.nih.gov/35653647/) | paper | open | `src/features/thousandEyes/indicators.ts` (sensor ring: drug), `specs/02-ui-dashboard.md` §2.4b |
| SRC-118 | [Wang et al. 2018, Monitoring of the central blood pressure waveform via a conformal ultrasonic device, Nat Biomed Eng 2:687](https://doi.org/10.1038/s41551-018-0287-x) (carotid and jugular waveforms) | paper | open | `src/features/thousandEyes/indicators.ts` (sensor ring: cbp, apw, vd), `specs/02-ui-dashboard.md` §2.4b |
| SRC-119 | [Hu et al. 2023, A wearable cardiac ultrasound imager, Nature 613:667](https://doi.org/10.1038/s41586-022-05498-z) (stroke volume, cardiac output, ejection fraction) | paper | open | `src/features/thousandEyes/indicators.ts` (sensor ring: co, sv, ef), `specs/02-ui-dashboard.md` §2.4b |
| SRC-120 | [A-Patch: wearable skin-VOC sensing patch, EU Horizon 2020 project 824270](https://cordis.europa.eu/project/id/824270) (Technion) | web | open | `src/features/thousandEyes/indicators.ts` (sensor ring: svoc), `specs/02-ui-dashboard.md` §2.4b |
| SRC-121 | [Nakhleh et al. 2017, Diagnosis and classification of 17 diseases from 1404 subjects via pattern analysis of exhaled molecules, ACS Nano 11:112](https://pmc.ncbi.nlm.nih.gov/articles/PMC5269643) (electronic-nose breath VOC patterns) | paper | open | `src/features/thousandEyes/indicators.ts` (sensor ring: bvoc), `specs/02-ui-dashboard.md` §2.4b |
| SRC-122 | [Issitt et al. 2022, Volatile compounds in human breath: critical review and meta-analysis, J Breath Res](https://eprints.whiterose.ac.uk/183477/) (acetone, isoprene) | paper | open | `src/features/thousandEyes/indicators.ts` (sensor ring: ace, iso), `specs/02-ui-dashboard.md` §2.4b |
| SRC-123 | [Boucsein et al. 2012, Publication recommendations for electrodermal measurements, Psychophysiology 49:1017](https://doi.org/10.1111/j.1469-8986.2012.01384.x) | paper | open | `src/features/thousandEyes/indicators.ts` (sensor ring: eda), `specs/02-ui-dashboard.md` §2.4b |
| SRC-124 | [Kim et al. 2011, Epidermal electronics, Science 333:838](https://doi.org/10.1126/science.1206157) (skin-mounted strain, temperature and electrophysiology sensors) | paper | open | `src/features/thousandEyes/indicators.ts` (sensor ring: strn), `specs/02-ui-dashboard.md` §2.4b |
| SRC-125 | [In vivo Raman spectroscopy tutorial review, J Biomed Opt 23(7):071210, 2018](https://doi.org/10.1117/1.JBO.23.7.071210) (NIR excitation for skin) | paper | open | `src/features/thousandEyes/indicators.ts` (sensor ring: rmn), `specs/02-ui-dashboard.md` §2.4b |
