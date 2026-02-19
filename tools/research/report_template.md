# Saving Pressure Study Report Template

## 1. Research Question

- Primary question:
  - Under fixed income/age conditions, how do `City_Tier`, `Occupation`, and `Dependents_Group` relate to `Pressure_Index_clip`?
- Secondary question:
  - Do the same factors relate to `Savings_Rate_clip` similarly or differently?
- Unit of analysis: individual (`PersonID`)

## 2. Data and Variables

- Dataset source:
- Time range / snapshot date:
- Sample size:
- Target variables:
  - `Pressure_Index_clip`
  - `Savings_Rate_clip`
- Key explanatory variables:
  - `City_Tier`
  - `Occupation`
  - `Dependents_Group`
- Control variables:
  - `Income`
  - `Age`

## 3. Model Specification

- Pressure model:
  - `Pressure_Index_clip ~ City_Tier + Occupation + Dependents_Group + Income + Age`
- Savings model:
  - `Savings_Rate_clip ~ City_Tier + Occupation + Dependents_Group + Income + Age`
- Interaction model:
  - `+ City_Tier:Occupation`
- Estimation method:
- Why this model matches the question:

## 4. Main Results

### 4.1 Factor ranges (group mean spread)

- Pressure top factor:
- Savings top factor:
- Notes:

### 4.2 Coefficients and model fit

- Pressure model `R2`:
- Savings model `R2`:
- Largest positive coefficients:
- Largest negative coefficients:

### 4.3 Interaction findings

- Cells with highest pressure:
- Cells with lowest pressure:
- Interpretation:

## 5. Clustering and Dimensionality Reduction (ML Layer)

- Clustering method:
  - Existing labels (`Cluster_KMeans`, `Cluster_GMM`) or retrained:
- Cluster profiles:
  - Cluster A:
  - Cluster B:
  - Cluster C:
- PCA/UMAP interpretation:
  - What is visible:
  - What is not inferable causally:

## 6. Individual-Level Explanation

- Case selection rule (top pressure / high residual / representative):
- Example person(s):
  - `PersonID`:
  - predicted pressure:
  - observed pressure:
  - residual:
  - key contributing features:

## 7. Robustness Checks

- Alternative model form tested:
- Result stability across:
  - dependents subsets
  - city tiers
  - occupation groups
- Sensitivity conclusions:

## 8. Limitations

- Observational limits:
- Potential confounders not included:
- Projection/cluster interpretation risks:

## 9. Final Answer to the Research Question

- One-paragraph direct answer:
- Practical implication:
- Next experiment:
