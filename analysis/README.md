# ARGUS analysis (Python)

Notebooks for NASA reference data and for checking crew analytics. Design and rules: `specs/05-data-platform.md` §7.

```bash
npm run data:nasa        # (repo root) load NASA reference data into DATABASE_URL, with provenance
npm run data:export      # (repo root) write data/exports/*.csv for the notebooks
cd analysis && uv sync
uv run jupyter lab notebooks/
# rebuild and re-run every notebook from source:
uv run python build_notebooks.py && uv run jupyter nbconvert --to notebook --execute --inplace notebooks/*.ipynb
```

| Notebook | Data | Question |
|---|---|---|
| `01_radiation_reference` | MSL RAD, DOSIS, NASA career limit [SRC-008, SRC-042..045] | Do ARGUS dose bands fit measured mission doses? |
| `02_inspiration4_cbc` | OSDR OSD-569 blood counts, 4 real crew [SRC-046, SRC-047] | Do personal baselines catch changes that population lab ranges miss? |
| `03_crew_baselines_eda` | ARGUS DB export (simulated wearables) | Do the server's baselines match pandas? What do circadian cycle and trend look like? |

Rules:
- Every number comes from pandas, scipy or statsmodels.
- `argus_analysis.ai.summarize()` only explains computed tables. It uses the local model first, labels its output, and is skipped when offline.
- Notebooks only read. They use exports, or `ANALYST_DATABASE_URL`, the read-only role.
- Edit `build_notebooks.py`, not the `.ipynb` files.
