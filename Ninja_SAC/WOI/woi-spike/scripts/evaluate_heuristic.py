#!/usr/bin/env python
"""
Evalúa el heurístico de incident reconstruction contra ground-truth manual.

Ground-truth format (CSV):
    message_id,gt_incident_id
    12345,1
    12346,1
    12347,2
    ...

Compara clusters vs clusters (message_id → incident_id) usando
Adjusted Rand Index + precision/recall/F1 sobre pares de mensajes co-clustered.
"""

from __future__ import annotations

import csv
import os
from collections import defaultdict
from itertools import combinations
from pathlib import Path

import click
import psycopg
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(REPO_ROOT / ".env")
DB_URL = os.environ["SUPABASE_DB_URL"]


def _load_ground_truth(csv_path: str) -> dict[int, int]:
    gt: dict[int, int] = {}
    with open(csv_path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                gt[int(row["message_id"])] = int(row["gt_incident_id"])
            except (ValueError, KeyError):
                continue
    return gt


def _load_predictions(message_ids: list[int]) -> dict[int, int | None]:
    if not message_ids:
        return {}
    query = """
        SELECT message_id, incident_id
        FROM analysis
        WHERE message_id = ANY(%s)
    """
    with psycopg.connect(DB_URL) as conn, conn.cursor() as cur:
        cur.execute(query, (message_ids,))
        return {row[0]: row[1] for row in cur.fetchall()}


def _pairwise_f1(gt: dict[int, int], pred: dict[int, int | None]) -> dict[str, float]:
    """
    Para cada par de mensajes, medir si están en el mismo incidente en gt y en pred.
    """
    ids = sorted(set(gt.keys()) & set(pred.keys()))
    if len(ids) < 2:
        return {"precision": 0.0, "recall": 0.0, "f1": 0.0, "n_pairs": 0}

    tp = fp = fn = tn = 0
    for a, b in combinations(ids, 2):
        same_gt = gt[a] == gt[b]
        same_pred = pred[a] is not None and pred[a] == pred[b]
        if same_gt and same_pred:
            tp += 1
        elif not same_gt and same_pred:
            fp += 1
        elif same_gt and not same_pred:
            fn += 1
        else:
            tn += 1

    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "n_pairs": tp + fp + fn + tn,
    }


def _cluster_stats(gt: dict[int, int], pred: dict[int, int | None]) -> dict[str, int]:
    gt_clusters = len(set(gt.values()))
    pred_clusters = len({v for v in pred.values() if v is not None})
    unassigned = sum(1 for v in pred.values() if v is None)
    return {
        "gt_incident_count": gt_clusters,
        "pred_incident_count": pred_clusters,
        "messages_without_incident": unassigned,
        "messages_labeled_gt": len(gt),
        "messages_with_pred": sum(1 for v in pred.values() if v is not None),
    }


def _error_samples(gt: dict[int, int], pred: dict[int, int | None], max_n: int = 10) -> list[dict]:
    """Ejemplos donde heurístico y GT discrepan."""
    samples = []
    ids = sorted(set(gt.keys()) & set(pred.keys()))
    for a, b in combinations(ids, 2):
        same_gt = gt[a] == gt[b]
        same_pred = pred[a] is not None and pred[a] == pred[b]
        if same_gt != same_pred:
            samples.append(
                {
                    "msg_a": a,
                    "msg_b": b,
                    "gt_same": same_gt,
                    "pred_same": same_pred,
                    "gt_a": gt[a], "gt_b": gt[b],
                    "pred_a": pred[a], "pred_b": pred[b],
                }
            )
        if len(samples) >= max_n:
            break
    return samples


@click.command()
@click.option("--gt-csv", type=click.Path(exists=True), required=True)
def main(gt_csv: str) -> None:
    gt = _load_ground_truth(gt_csv)
    pred = _load_predictions(list(gt.keys()))

    stats = _cluster_stats(gt, pred)
    pairwise = _pairwise_f1(gt, pred)
    errors = _error_samples(gt, pred, max_n=20)

    print("=" * 60)
    print("T0 Spike — Incident Reconstruction Evaluation")
    print("=" * 60)
    for k, v in stats.items():
        print(f"  {k}: {v}")
    print()
    print("Pairwise metrics:")
    for k, v in pairwise.items():
        print(f"  {k}: {v}")
    print()
    print("Decisión (basado en F1):")
    f1 = pairwise["f1"]
    if f1 >= 0.75:
        print(f"  F1 = {f1} >= 0.75 → MANTENER heurístico actual. Pasar a V1.")
    elif f1 >= 0.55:
        print(f"  F1 = {f1} ∈ [0.55, 0.75) → MEJORAR con 2-3 reglas específicas.")
    else:
        print(f"  F1 = {f1} < 0.55 → REEMPLAZAR por approach semántico.")
    print()
    print("Sample error cases (ver manualmente):")
    for e in errors[:10]:
        print(f"  {e}")


if __name__ == "__main__":
    main()
