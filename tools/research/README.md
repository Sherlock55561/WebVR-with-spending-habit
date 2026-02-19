# Saving Pressure Research Template

This template is for research questions like:

- controlling for `Income` and `Age`, how do `City_Tier`, `Occupation`, and `Dependents_Group` relate to `Pressure_Index_clip`?
- do the same factors relate to `Savings_Rate_clip` in the same direction?
- where does clustering add segmentation value, instead of replacing causal/association analysis?

## Why your current workflow gets stuck

Using only `PCA/UMAP/GMM` views is useful for pattern discovery, but it cannot directly answer "what influences pressure/savings".

- `PCA/UMAP`: geometry/projection tools
- `GMM/KMeans`: segmentation tools
- research question ("influence"): needs supervised effect estimation first

## Recommended workflow

1. **Question typing**
   - Association/explanatory question: start with supervised model.
   - Segmentation question: start with clustering.
2. **Baseline effect estimation**
   - Fit OLS-style models for both outcomes:
     - `Pressure_Index_clip ~ City_Tier + Occupation + Dependents_Group + Income + Age`
     - `Savings_Rate_clip ~ City_Tier + Occupation + Dependents_Group + Income + Age`
3. **Interaction check**
   - Add `City_Tier:Occupation` and compare group means by interaction cells.
4. **Cluster profiling (ML value)**
   - Use existing `Cluster_KMeans` / `Cluster_GMM` only as population segmentation.
   - Report cluster-level average pressure/savings and composition.
5. **Projection view (communication layer)**
   - Use PCA/UMAP only to visualize distribution and cluster overlap.
   - Do not treat projection distance as causal evidence.
6. **Individual explanation**
   - Use model coefficients + residuals to explain high-pressure individuals and outliers.

## Run

From repository root:

```powershell
python tools/research/saving_pressure_template.py `
  --data-dir examples/demos/1.0.11/data_examples `
  --output-dir tools/research/output
```

## Output files

- `summary.json`: sample size, model `R2`, top factor by range
- `effect_ranges_pressure.csv`: factor effect ranges for pressure
- `effect_ranges_savings.csv`: factor effect ranges for savings
- `ols_pressure_coefficients.csv`: OLS coefficients for pressure model
- `ols_savings_coefficients.csv`: OLS coefficients for savings model
- `means_by_city_tier.csv`: city-tier average outcomes
- `means_by_occupation.csv`: occupation average outcomes
- `means_by_dependents_group.csv`: dependents-group average outcomes
- `interaction_city_occupation_pressure.csv`: pressure interaction table
- `interaction_city_occupation_savings.csv`: savings interaction table
- `cluster_profiles.csv` (if cluster columns exist): cluster-level outcome means
- `projection_outcome_correlations.csv` (if projection columns exist): projection-outcome correlations

## How to adapt current BabiaXR demo workflow

Current `pca_points.html` workflow is useful for exploration but mixes analysis and display. Split it:

1. Run this template first and lock statistical conclusions.
2. Open `examples/demos/1.0.11/pca_points.html` to inspect where significant groups sit in PCA/UMAP space.
3. Treat visual findings as interpretation support, not primary evidence.

## Machine learning value in this question

ML is high-value for:

- segmentation (`GMM/KMeans`) to discover household archetypes
- nonlinear prediction experiments (`Pressure_Index_clip`) if your goal is forecasting
- anomaly detection (high residual individuals)

ML is low-value (alone) for:

- answering direct influence questions without a supervised explanatory model
- claiming variable effect size from projection plots alone

Use both:

- **Model-first for effect claims**
- **Cluster/projection-second for structure and storytelling**

## AI+VR experimental workflow

For interface-comparison experiments (`2D/VR x AI On/Off`), use this order:

1. Generate truth tables with `saving_pressure_template.py`.
2. Run participant sessions with:
   - `examples/demos/ai_vr_pressure/condition_2d_no_ai.html`
   - `examples/demos/ai_vr_pressure/condition_2d_ai.html`
   - `examples/demos/ai_vr_pressure/condition_vr_no_ai.html`
   - `examples/demos/ai_vr_pressure/condition_vr_ai.html`
3. Collect each exported participant log (`*.json`).
4. Score each log using:

```powershell
python tools/research/pressure_study_scoring.py `
  --study examples/demos/ai_vr_pressure/study_tasks.json `
  --submission <participant_log.json>
```

The scoring output contains `score`, `accuracy`, and `score_per_minute` for condition comparison.
