"""
AI summaries of COMPUTED tables (specs/05-data-platform.md §7 best practice).

The model only explains numbers that pandas/scipy already computed; it never sees raw data or computes
anything. Uses the same OpenAI-compatible settings as the ARGUS server (.env), local model first.
Returns None when no model is reachable, so notebooks still run offline.
"""

from __future__ import annotations

import os

import requests

from .data import load_env

SYSTEM = (
    "You are a data analyst for a NASA Space Apps astronaut-health project. You receive tables that were "
    "already computed with traditional statistics. Explain them in plain language for non-experts in at most "
    "6 bullet points. Do not invent numbers that are not in the tables. Label any interpretation as a "
    "hypothesis. End with one line: 'AI summary of computed statistics — not a medical assessment.'"
)


def summarize(title: str, table_markdown: str, timeout: int = 180) -> dict | None:
    load_env()
    candidates = []
    if os.environ.get("AI_LOCAL_MODEL"):
        candidates.append((os.environ.get("AI_LOCAL_BASE_URL", "http://localhost:11434/v1"), os.environ["AI_LOCAL_MODEL"], None))
    if os.environ.get("OPENROUTER_API_KEY"):
        candidates.append(("https://openrouter.ai/api/v1", os.environ.get("OPENROUTER_MODEL", "openrouter/free"), os.environ["OPENROUTER_API_KEY"]))
    for base, model, key in candidates:
        try:
            r = requests.post(
                f"{base.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {key}"} if key else {},
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": SYSTEM},
                        {"role": "user", "content": f"{title}\n\n{table_markdown}"},
                    ],
                    "temperature": 0.2,
                },
                timeout=timeout,
            )
            r.raise_for_status()
            text = r.json()["choices"][0]["message"]["content"]
            return {"model": model, "provider": base, "text": text}
        except Exception as exc:  # noqa: BLE001 — try the next provider
            print(f"(AI provider {base} unavailable: {exc.__class__.__name__})")
    return None
