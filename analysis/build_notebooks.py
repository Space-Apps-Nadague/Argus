"""
Builds the ARGUS analysis notebooks from source, so they are reviewable in git diffs.

    cd analysis && uv run python build_notebooks.py && uv run jupyter nbconvert --to notebook --execute --inplace notebooks/*.ipynb

Sources are cited by SOURCES.md ID (AGENTS.md §7).
"""

from pathlib import Path

import nbformat as nbf

OUT = Path(__file__).parent / "notebooks"

SETUP = """import sys, pathlib
sys.path.insert(0, str(pathlib.Path.cwd().parent))
import numpy as np, pandas as pd, matplotlib.pyplot as plt
from argus_analysis.data import export, REFERENCE
from argus_analysis.ai import summarize
pd.set_option('display.width', 140)
plt.rcParams.update({'figure.figsize': (9, 4), 'axes.grid': True, 'grid.alpha': 0.3})"""


def nb(cells):
    book = nbf.v4.new_notebook()
    book.metadata["kernelspec"] = {"name": "python3", "display_name": "Python 3", "language": "python"}
    book.cells = [nbf.v4.new_markdown_cell(c[3:]) if c.startswith("md:") else nbf.v4.new_code_cell(c) for c in cells]
    return book


radiation = nb([
    """md:# 01 · Radiation reference: how does ARGUS compare with measured spaceflight doses?

**Question.** ARGUS triages the daily dose `rad_dose` with fixed bands: nominal 0.4–1.2 mSv/day, yellow up to 2.5, red above (spec 01 §2). Do those bands fit measured doses in different mission environments, and how fast would a crew reach NASA's career limit?

**Data** (all open, curated in `data/reference/`, loaded to `ref_radiation_dose_rates` / `ref_thresholds`):
- MSL RAD in Curiosity's cruise stage, Mars transit [SRC-044]
- MSL RAD on the Mars surface [SRC-045]
- DOSIS 3D in ISS Columbus [SRC-042]
- NASA career limit of 600 mSv effective dose [SRC-008]

**Method.** Traditional arithmetic only: rates × days. An LLM summary at the end explains the computed table and adds no numbers.""",
    SETUP,
    """rates = pd.read_csv(REFERENCE / 'radiation_dose_rates.csv')
limit = pd.read_csv(REFERENCE / 'thresholds.csv').set_index('id').loc['career_effective_dose', 'limit_value']
rates[['environment', 'dose_rate_msv_per_day', 'quantity', 'instrument', 'source_id']]""",
    """md:Absorbed dose (mGy) and dose equivalent (mSv) are different quantities. Only the dose-equivalent rows can be compared with the 600 mSv limit and with ARGUS's mSv/day bands.""",
    """eq = rates[rates.quantity.str.startswith('dose equivalent')].copy()
eq['days_to_career_limit'] = (limit / eq.dose_rate_msv_per_day).round(0)
ARGUS = {'nominal_max': 1.2, 'yellow_max': 2.5}
eq['argus_status'] = np.select([eq.dose_rate_msv_per_day <= ARGUS['nominal_max'], eq.dose_rate_msv_per_day <= ARGUS['yellow_max']], ['green', 'yellow'], 'red')
eq[['environment', 'dose_rate_msv_per_day', 'days_to_career_limit', 'argus_status', 'source_id']]""",
    """# A reference Mars mission profile (illustrative durations): 180 d out, 500 d on the surface, 180 d back.
profile = pd.DataFrame({'leg': ['transit out', 'surface stay', 'transit back'], 'days': [180, 500, 180],
                        'rate': [eq.set_index('environment').loc['mars_transit', 'dose_rate_msv_per_day'],
                                 eq.set_index('environment').loc['mars_surface', 'dose_rate_msv_per_day'],
                                 eq.set_index('environment').loc['mars_transit', 'dose_rate_msv_per_day']]})
profile['dose_msv'] = (profile.days * profile.rate).round(0)
profile['cumulative_msv'] = profile.dose_msv.cumsum()
display(profile)
print(f"Total ≈ {profile.dose_msv.sum():.0f} mSv vs career limit {limit:.0f} mSv → {profile.dose_msv.sum() / limit:.1f}× the limit")""",
    """fig, ax = plt.subplots()
ax.bar(eq.environment, eq.dose_rate_msv_per_day, color=['#7c3aed', '#0891b2'])
ax.axhspan(0.4, 1.2, color='#22c55e', alpha=0.15, label='ARGUS nominal band')
ax.axhspan(1.2, 2.5, color='#eab308', alpha=0.15, label='ARGUS yellow band')
ax.set_ylabel('dose equivalent, mSv/day'); ax.set_title('Measured dose rates vs ARGUS rad_dose bands'); ax.legend()
plt.show()""",
    """md:### Findings (traditional analysis)
1. The cruise rate measured by MSL RAD (1.84 mSv/day) falls in ARGUS's **yellow** band. With today's fixed thresholds, every normal day of a Mars transit would show as "caution". The bands need to depend on location (REQ-07). The location is already stored per astronaut, so this is a spec change to `METRIC_THRESHOLDS`, not a data problem.
2. The Mars-surface rate (0.64 mSv/day) sits in the nominal band.
3. The illustrative 860-day mission exceeds the 600 mSv career limit. Cumulative dose (`dose_rate` summed over the mission) should become a tracked, derived metric next to the daily rate. The data is already in `observations`.""",
    """table = eq[['environment', 'dose_rate_msv_per_day', 'days_to_career_limit', 'argus_status']].to_markdown(index=False) + '\\n\\n' + profile.to_markdown(index=False)
ai = summarize('Radiation dose rates vs ARGUS thresholds and the 600 mSv career limit', table)
print(ai['text'] if ai else 'No AI provider reachable: the computed tables above are the result.')
if ai: print(f"\\n(model: {ai['model']})")""",
])

cbc = nb([
    """md:# 02 · Inspiration4 blood counts: personal baselines on real astronaut data

**Question.** ARGUS judges each astronaut against **their own** pre-flight baseline (spec 05 §5.2). Is that a sensible approach on real crew data, and does the published post-flight blood count support it?

**Data:** NASA OSDR study **OSD-569**, Inspiration4 Complete Blood Count [SRC-047], downloaded via the OSDR API [SRC-046] by `npm run data:nasa`.
- 4 crew (pseudonymous codes C001–C004).
- 3 pre-flight draws (L-92, L-44, L-3) and 4 post-flight draws (R+1, R+45, R+82, R+194).
- 20 analytes.

**Method:** traditional statistics only.
- Per-person baseline = mean of the 3 pre-flight draws.
- z-score and percent change at R+1.
- Share of values outside the lab reference range.
- With n = 4, results are **descriptive, not inferential**: no p-values are claimed.""",
    SETUP,
    """lab = export('ref_osdr_lab_values')
print(lab.subject.nunique(), 'crew ·', lab.timepoint.nunique(), 'timepoints ·', lab.analyte.nunique(), 'analytes ·', len(lab), 'values')
lab.head()""",
    """pre = lab[lab.phase == 'preflight'].groupby(['subject', 'analyte']).value.agg(base_mean='mean', base_sd='std', n='count').reset_index()
r1 = lab[lab.timepoint == 'R+1'][['subject', 'analyte', 'value', 'unit']].rename(columns={'value': 'r1'})
m = r1.merge(pre, on=['subject', 'analyte'])
m['pct_change'] = 100 * (m.r1 - m.base_mean) / m.base_mean
# n = 3 pre-flight draws → SD is unstable; floor it at 5 % of the mean (same idea as METRIC_TYPICAL_SD in ARGUS).
m['z'] = (m.r1 - m.base_mean) / np.maximum(m.base_sd, 0.05 * m.base_mean.abs())
summary = m.groupby('analyte').agg(mean_pct_change=('pct_change', 'mean'), min_pct=('pct_change', 'min'), max_pct=('pct_change', 'max'),
                                   crew_with_abs_z_over_2=('z', lambda s: int((s.abs() > 2).sum()))).round(1)
summary.sort_values('mean_pct_change', key=abs, ascending=False).head(10)""",
    """lab['out_of_range'] = (lab.value < lab.ref_min) | (lab.value > lab.ref_max)
oor = lab.groupby('phase').out_of_range.mean().mul(100).round(1).rename('% of values outside lab reference range')
oor.to_frame()""",
    """lym = lab[lab.analyte == 'absolute_lymphocytes'].copy()
lym['k_per_uL'] = lym.value / 1000  # ARGUS wbc_lymph unit is k/µL
fig, ax = plt.subplots()
for subj, g in lym.sort_values('days_from_launch').groupby('subject'):
    ax.plot(g.days_from_launch, g.k_per_uL, marker='o', label=subj)
ax.axhspan(1.5, 3.5, color='#22c55e', alpha=0.12, label='ARGUS wbc_lymph nominal')
ax.axvspan(0, 3, color='#94a3b8', alpha=0.3, label='flight (3 days)')
ax.set_xscale('symlog', linthresh=10); ax.set_xlabel('days from launch (symlog)'); ax.set_ylabel('lymphocytes, k/µL')
ax.set_title('Inspiration4 absolute lymphocytes per crew member'); ax.legend(ncol=3, fontsize=8)
plt.show()""",
    """# Population range vs personal baseline: how many R+1 values are inside the lab reference range,
# yet more than 2 personal SDs from that person's own baseline?
mm = m.merge(lab[lab.timepoint == 'R+1'][['subject', 'analyte', 'ref_min', 'ref_max']], on=['subject', 'analyte'])
inside_range = (mm.r1 >= mm.ref_min) & (mm.r1 <= mm.ref_max)
hidden = mm[inside_range & (mm.z.abs() > 2)]
print(f"{len(hidden)} of {inside_range.sum()} in-range R+1 values are >2 SD from the person's own baseline")
hidden[['subject', 'analyte', 'base_mean', 'r1', 'pct_change', 'z']].round(2).head(12)""",
    """md:### Findings (traditional analysis, descriptive)
- The table above shows which analytes moved most at R+1, the day after landing, relative to each person's own pre-flight mean.
- The last cell shows how often a value is **within the population lab range but unusual for that person**. A population range would miss these. This supports ARGUS's personal-baseline design, and the `preflight` baseline in `baselines` is exactly this calculation.
- **Caveats:**
  - 4 people, a 3-day mission, and post-flight draws only: no samples were taken in flight.
  - These are not long-duration microgravity effects.
  - Use this data as a methods check and as context for the AI, not as thresholds.""",
    """table = summary.sort_values('mean_pct_change', key=abs, ascending=False).head(8).to_markdown() + '\\n\\n' + oor.to_frame().to_markdown()
ai = summarize('Inspiration4 (OSD-569) CBC: change at R+1 vs each crew member\\'s pre-flight baseline (n=4, descriptive)', table)
print(ai['text'] if ai else 'No AI provider reachable: the computed tables above are the result.')
if ai: print(f"\\n(model: {ai['model']})")""",
])

crew = nb([
    """md:# 03 · ARGUS crew baselines: checking the TypeScript analytics with Python

**Question.** Do the baselines and anomaly detectors that the ARGUS server stores (spec 05 §5) match an independent computation in pandas/statsmodels? What does the circadian structure of the wearable data look like?

**Data:** `npm run data:export` from the ARGUS database. ⚠️ This is **simulated** data from the assumed sensor kit (`scripts/simulate-wearables.ts`, spec 05 §4), not astronaut data.

**Method:**
- Recompute the hour-of-day medians and compare them with the stored `baselines`.
- STL decomposition (statsmodels) of hourly heart rate into trend, daily cycle and residual.
- Review the anomaly table.""",
    SETUP,
    """hr = export('minute_heart_rate', parse_dates=['ts'])
base = export('baselines')
daily = export('daily_metrics', parse_dates=['day'])
anom = export('anomalies', parse_dates=['ts_start', 'ts_end'])
who = 'crew-lindqvist'
print(hr.astronaut_id.value_counts())""",
    """# 1. Validate stored hour-of-day medians against pandas.
h = hr[hr.astronaut_id == who].copy(); h['hour'] = h.ts.dt.hour
mine = h.groupby('hour').value.median().rename('pandas_median')
stored = base[(base.astronaut_id == who) & (base.metric_id == 'heart_rate') & (base.kind == 'hour_of_day')].set_index('hour')['median'].rename('stored_median')
cmp = pd.concat([mine, stored], axis=1).dropna()
cmp['diff'] = (cmp.pandas_median - cmp.stored_median).abs()
print('max |difference| =', cmp['diff'].max(), 'bpm  (small differences come from the export window vs the job window)')
cmp.head(24).T""",
    """# 2. STL decomposition of hourly heart rate (period = 24 h).
from statsmodels.tsa.seasonal import STL
s = h.set_index('ts').value.resample('1h').mean().interpolate()
res = STL(s, period=24, robust=True).fit()
fig = res.plot(); fig.set_size_inches(10, 6); fig.suptitle(f'{who}: hourly heart rate, STL decomposition', y=1.02)
plt.show()
print(f"Trend change over the window: {res.trend.iloc[-24:].mean() - res.trend.iloc[:24].mean():+.1f} bpm; "
      f"daily-cycle amplitude: {res.seasonal.max() - res.seasonal.min():.1f} bpm")""",
    """# 3. Daily radiation dose per astronaut against the personal pre-flight baseline.
rad = daily[daily.metric_id == 'rad_dose'].pivot(index='day', columns='astronaut_id', values='value')
ax = rad.plot(marker='.', title='rad_dose (mSv/day) from dosimeter minute data'); ax.axhline(2.5, color='#ef4444', ls='--', label='ARGUS red'); ax.legend(fontsize=8)
plt.show()""",
    """# 4. Anomalies found by the server job (informational: they never change triage).
anom.groupby(['astronaut_id', 'detector', 'severity']).size().unstack(fill_value=0)""",
    """md:### Findings
- If the stored hour-of-day medians match pandas to within the export window, the server implementation is independently confirmed.
- STL separates a slow **trend** (scenario drift) from the **daily cycle**. That is why ARGUS compares minute heart rate with the same hour of day (`hour_of_day` baseline) rather than with one daily mean.
- Possible next step: replace the hour-of-day median with an STL-based expected value once the model is promoted from this notebook into `shared/analytics/` (spec 05 §7, "notebooks are never the source of truth").""",
])

OUT.mkdir(exist_ok=True)
for name, book in {"01_radiation_reference": radiation, "02_inspiration4_cbc": cbc, "03_crew_baselines_eda": crew}.items():
    nbf.write(book, OUT / f"{name}.ipynb")
    print("wrote", OUT / f"{name}.ipynb")
