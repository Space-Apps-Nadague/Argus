"""
Data access for notebooks.

Reads the CSV exports in data/exports/ (written by `npm run data:export`), which work with every database
engine. With a postgres:// DATABASE_URL (for example the read-only argus_analyst role on Azure), `query()`
reads the database directly instead. Notebooks never write to the database: only pipelines do.
"""

from __future__ import annotations

import os
from pathlib import Path

import pandas as pd

REPO = Path(__file__).resolve().parents[2]
EXPORTS = REPO / "data" / "exports"
REFERENCE = REPO / "data" / "reference"


def load_env() -> None:
    env = REPO / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def export(name: str, **kw) -> pd.DataFrame:
    path = EXPORTS / f"{name}.csv"
    if not path.exists():
        raise FileNotFoundError(f"{path} missing: run `npm run data:export` in the repo root first")
    return pd.read_csv(path, **kw)


def query(sql: str) -> pd.DataFrame | None:
    """Direct read from a postgres:// DATABASE_URL (or ANALYST_DATABASE_URL); None if not configured."""
    load_env()
    url = os.environ.get("ANALYST_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
    if not url.startswith("postgres"):
        return None
    import psycopg

    with psycopg.connect(url) as conn:
        return pd.read_sql(sql, conn)
