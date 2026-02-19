"""
Build BabiaXR-ready CSV files from the raw archive dataset.

This script intentionally keeps one deterministic pipeline:
1) feature engineering
2) KMeans/GMM clustering
3) PCA/UMAP embeddings
4) export combined + per-dependents-group CSV files
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.mixture import GaussianMixture
from sklearn.preprocessing import StandardScaler
import umap


SPEND_COLS = [
    "Rent",
    "Loan_Repayment",
    "Insurance",
    "Groceries",
    "Transport",
    "Eating_Out",
    "Entertainment",
    "Utilities",
    "Healthcare",
    "Education",
    "Miscellaneous",
]

REQUIRED_COLUMNS = [
    "Income",
    "Age",
    "Dependents",
    "Occupation",
    "City_Tier",
    "Desired_Savings",
] + SPEND_COLS


def _read_input(input_path: str | Path) -> pd.DataFrame:
    path = Path(input_path)
    # pandas can read .csv and .zip directly with the same call.
    return pd.read_csv(path)


def _validate_columns(df: pd.DataFrame) -> None:
    missing = [col for col in REQUIRED_COLUMNS if col not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")


def _map_dependents_group(dep_value: Any) -> str | None:
    if pd.isna(dep_value):
        return None
    dep = int(dep_value)
    # Keep compatibility with existing Babia demo files (1,2,3,4+).
    if dep == 1:
        return "1"
    if dep == 2:
        return "2"
    if dep == 3:
        return "3"
    if dep >= 4:
        return "4+"
    return None


def _engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()

    out = out.reset_index(drop=True)
    out["PersonID"] = out.index.map(lambda i: f"PID_{i:06d}")

    out["Dependents_Group"] = out["Dependents"].map(_map_dependents_group)
    out = out[out["Dependents_Group"].notna()].copy()

    out["Income"] = out["Income"].replace(0, np.nan)
    out["Total_Spend"] = out[SPEND_COLS].sum(axis=1)

    for col in SPEND_COLS:
        out[f"Share_{col}"] = (out[col] / out["Total_Spend"]).replace([np.inf, -np.inf], np.nan)

    share_cols = [f"Share_{col}" for col in SPEND_COLS]
    out[share_cols] = out[share_cols].fillna(0.0)

    out["Savings_Rate"] = out["Desired_Savings"] / out["Income"]
    out["Pressure_Index"] = out["Total_Spend"] / out["Income"]

    for col in ["Savings_Rate", "Pressure_Index"]:
        out[col] = out[col].replace([np.inf, -np.inf], np.nan)

    out["Savings_Rate_clip"] = out["Savings_Rate"].copy()
    out["Pressure_Index_clip"] = out["Pressure_Index"].copy()
    for col in ["Savings_Rate_clip", "Pressure_Index_clip"]:
        low, high = out[col].quantile([0.01, 0.99])
        out[col] = out[col].clip(low, high)

    fixed_costs = ["Share_Rent", "Share_Loan_Repayment", "Share_Utilities", "Share_Insurance"]
    living_costs = ["Share_Groceries", "Share_Transport", "Share_Healthcare"]
    discretionary = ["Share_Eating_Out", "Share_Entertainment", "Share_Miscellaneous", "Share_Education"]

    out["Fixed_Cost_Share"] = out[fixed_costs].sum(axis=1)
    out["Living_Cost_Share"] = out[living_costs].sum(axis=1)
    out["Discretionary_Share"] = out[discretionary].sum(axis=1)

    # Keep the same bin labels used by prior outputs.
    out["Income_Bin"] = pd.qcut(
        out["Income"],
        q=5,
        labels=["Q1_Low", "Q2", "Q3", "Q4", "Q5_High"],
        duplicates="drop",
    )

    return out


def _fit_embeddings_and_clusters(df: pd.DataFrame, k: int, random_state: int) -> pd.DataFrame:
    out = df.copy()

    x_cols = [
        "Fixed_Cost_Share",
        "Living_Cost_Share",
        "Discretionary_Share",
        "Savings_Rate_clip",
        "Pressure_Index_clip",
    ]

    x = out[x_cols].astype(float).fillna(0.0)
    scaler = StandardScaler()
    x_scaled = scaler.fit_transform(x)

    kmeans = KMeans(n_clusters=k, n_init=20, random_state=random_state)
    out["Cluster_KMeans"] = kmeans.fit_predict(x_scaled)

    gmm = GaussianMixture(n_components=k, covariance_type="full", random_state=random_state)
    out["Cluster_GMM"] = gmm.fit_predict(x_scaled)
    gmm_probs = gmm.predict_proba(x_scaled)
    for idx in range(k):
        out[f"GMM_Prob_{idx}"] = gmm_probs[:, idx]

    pca = PCA(n_components=3, random_state=random_state)
    pca_coords = pca.fit_transform(x_scaled)
    out["PCA1"] = pca_coords[:, 0]
    out["PCA2"] = pca_coords[:, 1]
    out["PCA3"] = pca_coords[:, 2]

    umap_model = umap.UMAP(
        n_components=3,
        n_neighbors=30,
        min_dist=0.1,
        random_state=random_state,
    )
    umap_coords = umap_model.fit_transform(x_scaled)
    out["UMAP1"] = umap_coords[:, 0]
    out["UMAP2"] = umap_coords[:, 1]
    out["UMAP3"] = umap_coords[:, 2]

    return out


def build_babia_dataset(
    input_path: str | Path,
    output_dir: str | Path,
    *,
    k: int = 4,
    random_state: int = 42,
) -> dict[str, Any]:
    raw = _read_input(input_path)
    _validate_columns(raw)

    featured = _engineer_features(raw)
    modeled = _fit_embeddings_and_clusters(featured, k=k, random_state=random_state)

    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    all_path = out_dir / "babiaxr_all_dependents_groups.csv"
    modeled.to_csv(all_path, index=False)

    groups = ["1", "2", "3", "4+"]
    for group in groups:
        group_df = modeled[modeled["Dependents_Group"] == group].copy()
        group_df.to_csv(out_dir / f"babiaxr_dependents_{group}.csv", index=False)

    summary = {
        "input_path": str(input_path),
        "output_dir": str(out_dir),
        "rows_all": int(len(modeled)),
        "dependents_groups": groups,
        "kmeans_k": int(k),
        "gmm_components": int(k),
    }
    (out_dir / "babiaxr_build_summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return summary


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build BabiaXR CSVs from archive dataset.")
    parser.add_argument("--input", default="archive.zip", help="Input raw dataset (.csv or .zip).")
    parser.add_argument(
        "--output-dir",
        default="examples/demos/1.0.11/data_examples",
        help="Output directory for babiaxr_*.csv files.",
    )
    parser.add_argument("--k", type=int, default=4, help="K for KMeans and GMM components.")
    parser.add_argument("--seed", type=int, default=42, help="Random seed.")
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    summary = build_babia_dataset(
        input_path=args.input,
        output_dir=args.output_dir,
        k=args.k,
        random_state=args.seed,
    )
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
