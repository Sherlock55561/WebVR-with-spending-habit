# AI+VR Pressure Study Demo

This folder contains a minimal experiment package for comparing:

- `2D + No AI`
- `2D + AI(ML)`
- `VR + No AI`
- `VR + AI(ML)`

All conditions use the same tasks and truth labels defined in `study_tasks.json`.

Notes:

- All conditions now run dual endpoints:
  - group endpoint via `babia-bubbles`
  - individual endpoint via `babia-points` (point cloud)
- 2D conditions use native 2D visuals:
  - heatmap for group endpoint
  - scatter (PCA/UMAP switch) for individual endpoint
- Point cloud defaults to PCA and allows optional UMAP switching.
- Reference tables are hidden by default so participants rely on visual analysis.

## Files

- `index.html`: launcher page
- `condition_2d_no_ai.html`
- `condition_2d_ai.html`
- `condition_vr_no_ai.html`
- `condition_vr_ai.html`
- `study_tasks.json`: task definitions + correct answers + reference tables
- `study_conditions.json`: condition metadata
- `study-common.js`: task rendering, logging, JSON export
- `study-style.css`: shared styles

## Run

Serve repository root (for example):

```powershell
npm run dev -- --port 3000 --no-open
```

Open:

`http://127.0.0.1:3000/examples/demos/ai_vr_pressure/index.html`

## Per-participant output

Each condition page exports one local JSON log file when user clicks submit.

Log includes:

- group-task answers
- individual-task payload (`selected_person_id`, `evidence_tags`)
- `view_usage` (e.g. PCA/UMAP usage)
- total duration and click counts

## Scoring

Use:

```powershell
python tools/research/pressure_study_scoring.py ^
  --study examples/demos/ai_vr_pressure/study_tasks.json ^
  --submission <participant_log.json>
```

The script prints:

- total score
- max score
- accuracy
- score per minute
- task-by-task correctness
