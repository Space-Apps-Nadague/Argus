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
| SRC-004 | [Exploration Medical Condition List, NTRS 20110008645](https://ntrs.nasa.gov/api/citations/20110008645/downloads/20110008645.pdf) (Watkins, Barr & Kerstman, 2011) | paper | open | `src/data/emergencyProtocols.ts`, `server/models/diagnosticsRules.ts` |
| SRC-005 | [NASA Life Sciences Portal: Experiments Explorer](https://nlsp.nasa.gov/explore?dataType=EXPERIMENTS) (NLSP / LSDA) | dataset | request | `specs/05-data-platform.md` §7 (why per-astronaut data must be simulated) |
| SRC-006 | [Lifetime Surveillance of Astronaut Health (LSAH)](https://nlsp.nasa.gov/resources/lsah) | dataset | restricted | `specs/05-data-platform.md` §7 |
| SRC-007 | [NASA-STD-3001 Vol 1 Rev C: Crew Health](https://standards.nasa.gov/sites/default/files/standards/NASA/C//nasa-std-3001-vol-1-rev-c-signature.pdf) (2023) | standard | open | `data/reference/thresholds.csv`, `ref_thresholds`, `analysis/notebooks/01_radiation_reference.ipynb` |
| SRC-008 | [OCHMO Radiation Protection Technical Brief](https://www.nasa.gov/wp-content/uploads/2023/03/radiation-protection-technical-brief-ochmo.pdf) (600 mSv career limit) | standard | open | `data/reference/thresholds.csv`, `analysis/notebooks/01_radiation_reference.ipynb` |
| SRC-009 | [Spaceflight Standard Measures](https://www.nasa.gov/humans-in-space/spaceflight-standard-measures-characterizing-how-humans-adapt-in-space) (NASA) | web | open | `specs/05-data-platform.md` §4 (sensor kit: actigraphy, surveys, cognition) |
| SRC-010 | [HRP Evidence Reports / Human Research Roadmap](https://humanresearchroadmap.nasa.gov/evidence/) | paper | open | `specs/05-data-platform.md` §8 (AI context, future RAG) |

## Wearables and passive monitoring flown in space

| ID | Source | Type | Access | Used in |
|---|---|---|---|---|
| SRC-020 | [CSA Bio-Monitor / Astroskin](https://www.asc-csa.gc.ca/eng/sciences/astroskin.asp) (Canadian Space Agency) | web | open | `specs/05-data-platform.md` §4, `scripts/simulate-wearables.ts` (smart shirt device) |
| SRC-021 | [Astroskin sensor sampling rates](https://support.hexoskin.com/en/astroskin/what-is-the-sampling-rate-for-the-astroskin-sensors) (Hexoskin) | web | open | `specs/05-data-platform.md` §4 (1 Hz vitals, 250 Hz ECG on device) |
| SRC-022 | [Bio-Monitor validation, NTRS 20190000238](https://ntrs.nasa.gov/api/citations/20190000238/downloads/20190000238.pdf) | paper | open | `specs/05-data-platform.md` §4 |
| SRC-023 | [Actigraphy in spaceflight, NTRS 20200001281](https://ntrs.nasa.gov/api/citations/20200001281/downloads/20200001281.pdf) (Actiwatch Spectrum) | paper | open | `specs/05-data-platform.md` §4, `scripts/simulate-wearables.ts` (sleep blocks, actigraph) |
| SRC-024 | [Artemis II crew research (ARCHeR)](https://www.nasa.gov/humans-in-space/artemis-ii-crew-to-advance-human-spaceflight-research/) (NASA) | web | open | `specs/05-data-platform.md` §4 |
| SRC-025 | [ESA "Keeping the rhythm in space"](https://www.esa.int/Science_Exploration/Human_and_Robotic_Exploration/Research/Keeping_the_rhythm_in_space) (Circadian Rhythms, Double Sensor core temperature) | web | open | `specs/05-data-platform.md` §4, `scripts/simulate-wearables.ts` (core-temp rise, ~2 h circadian shift) |
| SRC-026 | [ISS Crew Active Dosimeter](https://read.qxmd.com/read/37945094/the-importance-of-time-resolved-personal-dosimetry-in-space-the-iss-crew-active-dosimeter) (Gaza et al., 2023) | paper | open | `specs/05-data-platform.md` §4, `scripts/simulate-wearables.ts` (dosimeter device) |
| SRC-027 | [Inspiration4 wearables (Apple Watch)](https://pmc.ncbi.nlm.nih.gov/articles/PMC11357997) | paper | open | `specs/05-data-platform.md` §4 (commercial precedent) |
| SRC-028 | [Polaris Dawn health research data collection](https://trialx.com/supporting-health-research-data-collection-for-the-polaris-dawn-commercial-space-mission) (Garmin, Dexcom, TRISH EXPAND) | web | open | `specs/05-data-platform.md` §4 (commercial precedent) |
| SRC-029 | [Ax-4 ISS edge computing for crew readiness](https://axiomspace.com/research/iss-edge-computing-for-crew-readiness-demonstration) (Oura ring) | web | open | `specs/05-data-platform.md` §4 (ring: nightly HRV, resting HR) |

## Radiation and open datasets

| ID | Source | Type | Access | Used in |
|---|---|---|---|---|
| SRC-040 | [Monitoring Radiation for Astronaut Health](https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp) (CSA) | web | open | `specs/05-data-platform.md` §4 (dosimetry context) |
| SRC-041 | [Why Do We Conduct Science Experiments in Space?](https://www.asc-csa.gc.ca/eng/iss/science/why-do-we-conduct-science-experiments-in-space.asp) (CSA) | web | open | `README.md` (project context) |
| SRC-042 | [DOSIS 3D: ISS Columbus dose rates](https://www.swsc-journal.org/articles/swsc/abs/2017/01/swsc160046/swsc160046.html) (Berger et al., SWSC 2017) | paper | open | `scripts/simulate-wearables.ts` (LEO dose rate), `data/reference/radiation_dose_rates.csv` |
| SRC-043 | [Curiosity MSL RAD data (ISWA/CDAWeb)](https://iswa.gsfc.nasa.gov/iswa_data_tree/information/MSLRAD.html) | dataset | open | `analysis/pipelines/ingest_msl_rad.py`, `ref_radiation_dose_rates`, `scripts/simulate-wearables.ts` (Mars dose rates) |
| SRC-044 | [Zeitlin et al. 2013, Science: radiation during Mars cruise (MSL RAD)](https://www.science.org/doi/10.1126/science.1235989) | paper | open | `data/reference/radiation_dose_rates.csv` (≈1.84 mSv/day cruise) |
| SRC-045 | [Hassler et al. 2014, Science: Mars surface radiation (MSL RAD)](https://www.science.org/doi/10.1126/science.1244797) | paper | open | `data/reference/radiation_dose_rates.csv` (≈0.67 mSv/day surface) |
| SRC-046 | [NASA OSDR Biological Data API](https://visualization.osdr.nasa.gov/biodata/api) | api | open | `analysis/pipelines/ingest_osdr.py`, `ref_osdr_studies` |
| SRC-047 | [Inspiration4 datasets on OSDR (OSD-569…575)](https://www.nasa.gov/osdr-latest-news-i4-mission-datasets/) | dataset | open | `analysis/pipelines/ingest_osdr.py`, `analysis/notebooks/02_inspiration4_biomarkers.ipynb` |
| SRC-048 | [SOMA: Space Omics and Medical Atlas](https://soma.weill.cornell.edu) | dataset | open | `specs/05-data-platform.md` §7 (context only) |
| SRC-049 | [OSDR FAQ: data access levels](https://science.nasa.gov/reference/osdr-faq) | web | open | `specs/05-data-platform.md` §7 |

## Software and security practice

| ID | Source | Type | Access | Used in |
|---|---|---|---|---|
| SRC-060 | [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) (argon2id parameters) | standard | open | `server/auth/passwords.ts` |
| SRC-061 | [Azure PostgreSQL Flexible Server on the free account](https://learn.microsoft.com/azure/postgresql/flexible-server/how-to-deploy-on-azure-free-account) | web | open | `scripts/azure/provision.sh`, `docs/DATABASE.md` |
| SRC-062 | [Azure PostgreSQL extensions by engine version](https://learn.microsoft.com/azure/postgresql/extensions/concepts-extensions-by-engine) | web | open | `specs/05-data-platform.md` §2, `scripts/azure/provision.sh` |
| SRC-063 | [Robust z-score with MAD (Iglewicz & Hoaglin, NIST e-Handbook 1.3.5.17)](https://www.itl.nist.gov/div898/handbook/eda/section3/eda35h.htm) | standard | open | `shared/analytics/baselines.ts` |
| SRC-064 | [EWMA and CUSUM control charts (NIST e-Handbook 6.3.2)](https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc32.htm) | standard | open | `shared/analytics/anomalies.ts` |
