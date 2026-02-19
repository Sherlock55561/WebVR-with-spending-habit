"""
Reusable research template for analyzing saving-pressure relationships.

This script is intentionally lightweight: pandas + numpy only.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd


DEFAULT_GROUP_FILES = [
    "babiaxr_dependents_1.csv",
    "babiaxr_dependents_2.csv",
    "babiaxr_dependents_3.csv",
    "babiaxr_dependents_4+.csv",
]

REQUIRED_COLUMNS = [
    "Dependents_Group",
    "City_Tier",
    "Occupation",
    "Income",
    "Age",
    "Savings_Rate_clip",
    "Pressure_Index_clip",
]


def load_dataset(data_dir: str | Path, files: Iterable[str] | None = None) -> pd.DataFrame:
    data_path = Path(data_dir)
    group_files = list(files) if files is not None else DEFAULT_GROUP_FILES

    frames: list[pd.DataFrame] = []
    missing: list[str] = []
    for filename in group_files:
        file_path = data_path / filename
        if not file_path.exists():
            missing.append(str(file_path))
            continue
        frame = pd.read_csv(file_path)
        frame["source_file"] = filename
        frames.append(frame)

    if missing:
        raise FileNotFoundError(
            "Missing required input files:\n" + "\n".join(missing)
        )
    if not frames:
        raise ValueError(f"No data frames loaded from: {data_path}")

    return pd.concat(frames, ignore_index=True)


def compute_effect_ranges(df: pd.DataFrame, target: str, factors: Iterable[str]) -> pd.DataFrame:
    rows = []
    for factor in factors:
        means = df.groupby(factor, dropna=False)[target].mean()
        rows.append(
            {
                "factor": factor,
                "levels": int(means.shape[0]),
                "min_group_mean": float(means.min()),
                "max_group_mean": float(means.max()),
                "range": float(means.max() - means.min()),
            }
        )
    return pd.DataFrame(rows).sort_values("range", ascending=False).reset_index(drop=True)


def _prepare_design_matrix(
    df: pd.DataFrame,
    categorical: Iterable[str],
    numeric: Iterable[str],
) -> tuple[np.ndarray, np.ndarray, list[str]]:
    x = df[list(categorical) + list(numeric)].copy()
    x = pd.get_dummies(x, columns=list(categorical), drop_first=True)
    x = x.astype(float)

    # Standardize numeric columns for coefficient comparability.
    for col in numeric:
        mean = x[col].mean()
        std = x[col].std(ddof=0)
        if std == 0:
            std = 1.0
        x[col] = (x[col] - mean) / std

    feature_names = list(x.columns)
    x_matrix = np.column_stack([np.ones(len(x)), x.values]).astype(float)
    return x_matrix, x.values.astype(float), ["Intercept"] + feature_names


def fit_ols_numpy(
    df: pd.DataFrame,
    target: str,
    categorical: Iterable[str],
    numeric: Iterable[str],
) -> tuple[pd.DataFrame, float]:
    y = df[target].astype(float).values
    x_matrix, _, names = _prepare_design_matrix(df, categorical, numeric)

    beta, *_ = np.linalg.lstsq(x_matrix, y, rcond=None)
    y_hat = x_matrix @ beta
    ss_res = float(np.sum((y - y_hat) ** 2))
    ss_tot = float(np.sum((y - float(np.mean(y))) ** 2))
    r2 = 0.0 if ss_tot == 0 else 1.0 - (ss_res / ss_tot)

    coeffs = pd.DataFrame(
        {
            "feature": names,
            "coefficient": beta,
            "abs_coefficient": np.abs(beta),
        }
    ).sort_values("abs_coefficient", ascending=False)
    return coeffs.reset_index(drop=True), float(r2)


def _require_columns(df: pd.DataFrame, required: Iterable[str]) -> None:
    missing = [col for col in required if col not in df.columns]
    if missing:
        raise ValueError(f"Input data missing required columns: {missing}")


def _corr_table(df: pd.DataFrame, outcomes: Iterable[str], candidates: Iterable[str]) -> pd.DataFrame:
    rows = []
    for candidate in candidates:
        if candidate not in df.columns:
            continue
        if not np.issubdtype(df[candidate].dtype, np.number):
            continue
        for outcome in outcomes:
            if outcome not in df.columns:
                continue
            corr = df[candidate].corr(df[outcome])
            rows.append(
                {
                    "feature": candidate,
                    "outcome": outcome,
                    "pearson_corr": float(corr),
                }
            )
    table = pd.DataFrame(rows)
    if table.empty:
        return table
    return table.sort_values("pearson_corr", key=lambda s: s.abs(), ascending=False)


def run_analysis(data_dir: str | Path, output_dir: str | Path) -> dict:
    df = load_dataset(data_dir)
    _require_columns(df, REQUIRED_COLUMNS)

    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    factors = ["City_Tier", "Occupation", "Dependents_Group"]
    effect_pressure = compute_effect_ranges(df, "Pressure_Index_clip", factors)
    effect_savings = compute_effect_ranges(df, "Savings_Rate_clip", factors)
    effect_pressure.to_csv(out_path / "effect_ranges_pressure.csv", index=False)
    effect_savings.to_csv(out_path / "effect_ranges_savings.csv", index=False)

    categorical = ["Dependents_Group", "City_Tier", "Occupation"]
    numeric = ["Income", "Age"]
    coeff_pressure, r2_pressure = fit_ols_numpy(df, "Pressure_Index_clip", categorical, numeric)
    coeff_savings, r2_savings = fit_ols_numpy(df, "Savings_Rate_clip", categorical, numeric)
    coeff_pressure.to_csv(out_path / "ols_pressure_coefficients.csv", index=False)
    coeff_savings.to_csv(out_path / "ols_savings_coefficients.csv", index=False)

    city_means = df.groupby("City_Tier")[["Pressure_Index_clip", "Savings_Rate_clip"]].mean().reset_index()
    occ_means = df.groupby("Occupation")[["Pressure_Index_clip", "Savings_Rate_clip"]].mean().reset_index()
    dep_means = df.groupby("Dependents_Group")[["Pressure_Index_clip", "Savings_Rate_clip"]].mean().reset_index()
    city_means.to_csv(out_path / "means_by_city_tier.csv", index=False)
    occ_means.to_csv(out_path / "means_by_occupation.csv", index=False)
    dep_means.to_csv(out_path / "means_by_dependents_group.csv", index=False)

    interaction_pressure = (
        df.groupby(["City_Tier", "Occupation"])["Pressure_Index_clip"]
        .mean()
        .unstack(fill_value=np.nan)
        .reset_index()
    )
    interaction_savings = (
        df.groupby(["City_Tier", "Occupation"])["Savings_Rate_clip"]
        .mean()
        .unstack(fill_value=np.nan)
        .reset_index()
    )
    interaction_pressure.to_csv(out_path / "interaction_city_occupation_pressure.csv", index=False)
    interaction_savings.to_csv(out_path / "interaction_city_occupation_savings.csv", index=False)

    cluster_rows = []
    for cluster_col in ["Cluster_KMeans", "Cluster_GMM"]:
        if cluster_col in df.columns:
            table = (
                df.groupby(cluster_col)[["Pressure_Index_clip", "Savings_Rate_clip"]]
                .mean()
                .reset_index()
            )
            table.insert(0, "cluster_source", cluster_col)
            cluster_rows.append(table)
    if cluster_rows:
        pd.concat(cluster_rows, ignore_index=True).to_csv(out_path / "cluster_profiles.csv", index=False)

    projection_candidates = [
        "PCA1",
        "PCA2",
        "PCA3",
        "UMAP1",
        "UMAP2",
        "UMAP3",
        "GMM_Prob_0",
        "GMM_Prob_1",
        "GMM_Prob_2",
        "GMM_Prob_3",
    ]
    corr_table = _corr_table(
        df=df,
        outcomes=["Pressure_Index_clip", "Savings_Rate_clip"],
        candidates=projection_candidates,
    )
    if not corr_table.empty:
        corr_table.to_csv(out_path / "projection_outcome_correlations.csv", index=False)

    top_pressure_factor = (
        effect_pressure.iloc[0]["factor"] if not effect_pressure.empty else None
    )
    top_savings_factor = (
        effect_savings.iloc[0]["factor"] if not effect_savings.empty else None
    )

    summary = {
        "row_count": int(len(df)),
        "city_tier_levels": sorted(df["City_Tier"].astype(str).dropna().unique().tolist()),
        "occupation_levels": sorted(df["Occupation"].astype(str).dropna().unique().tolist()),
        "dependents_levels": sorted(df["Dependents_Group"].astype(str).dropna().unique().tolist()),
        "r2_pressure_ols": round(float(r2_pressure), 6),
        "r2_savings_ols": round(float(r2_savings), 6),
        "top_pressure_range_factor": top_pressure_factor,
        "top_savings_range_factor": top_savings_factor,
    }
    (out_path / "summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return summary


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Saving pressure research template runner.")
    parser.add_argument(
        "--data-dir",
        default="examples/demos/1.0.11/data_examples",
        help="Directory containing dependent-group CSV files.",
    )
    parser.add_argument(
        "--output-dir",
        default="tools/research/output",
        help="Directory where analysis outputs are written.",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    summary = run_analysis(args.data_dir, args.output_dir)
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
