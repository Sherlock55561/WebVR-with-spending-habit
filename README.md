# WebVR Spending Habit Pressure Study

This repository contains a WebVR research prototype for visualizing spending-habit pressure data. It compares how users analyze the same tasks across 2D, VR, AI-assisted, and non-AI conditions.

The project is built as a modified fork of BabiaXR `aframe-babia-components`, an A-Frame component library for browser-based 3D and VR data visualization.

## Sample Video

Paste your sample video link here after uploading it to GitHub, YouTube, OneDrive, Google Drive, or another video host:

```md
[Watch the sample video](PASTE_VIDEO_URL_HERE)
```

Recommended GitHub workflow:

1. Upload the video through the GitHub README editor, an issue, or a release.
2. Copy the generated video URL.
3. Replace `PASTE_VIDEO_URL_HERE` above with that URL.

Avoid committing large `.mp4` files directly to the repository.

## Project Overview

The custom study package compares four experimental conditions:

| Condition | Environment | AI Support |
| --- | --- | --- |
| `2D + No AI` | Browser-based 2D visualization | No |
| `2D + AI` | Browser-based 2D visualization | Yes |
| `VR + No AI` | WebVR visualization | No |
| `VR + AI` | WebVR visualization | Yes |

All conditions use the same task definitions and reference answers from `examples/demos/ai_vr_pressure/study_tasks.json`.

## Custom Contributions

This repository extends the BabiaXR base with:

- An AI + VR pressure-study demo under `examples/demos/ai_vr_pressure/`.
- Four condition pages for 2D/VR and AI/non-AI comparison.
- A point-cloud visualizer based on `babia-points`.
- VR tri-view point clouds using PCA, UMAP, and GMM views.
- 2D heatmap and scatter-style task interfaces.
- Pressure, income, and blended color modes.
- Occupation and city-tier filtering for participant analysis.
- Participant answer logging and JSON export.
- Research scoring utilities under `tools/research/`.

## Relationship To BabiaXR

This is not a clean-room project. It is a modified fork of:

- Original project: https://gitlab.com/babiaxr/aframe-babia-components
- BabiaXR website: https://babiaxr.gitlab.io/
- Original package: https://www.npmjs.com/package/aframe-babia-components
- License: GPL-3.0

Most of the underlying A-Frame visualization framework comes from BabiaXR. The custom work in this repository focuses on the WebVR spending-habit pressure study, the experimental condition pages, the point-cloud extensions, and the research workflow around participant tasks and scoring.

## Repository Structure

```text
components/
  others/
    babia-ui.js                 Custom UI changes on top of BabiaXR
  visualizers/
    babia-bubbles.js            Modified group visualization behavior
    babia-points.js             Custom point-cloud visualizer

examples/demos/ai_vr_pressure/
  index.html                    Study launcher
  condition_2d_no_ai.html       2D condition without AI support
  condition_2d_ai.html          2D condition with AI support
  condition_vr_no_ai.html       VR condition without AI support
  condition_vr_ai.html          VR condition with AI support
  study-common.js               Shared task, logging, and export logic
  study-style.css               Shared study UI styling
  study_tasks.json              Task definitions and answers
  study_conditions.json         Condition metadata

tools/research/
  pressure_study_scoring.py     Participant log scoring script
```

## Run Locally

Install dependencies:

```powershell
npm install
```

Start the development server:

```powershell
npm run dev -- --port 3000 --no-open
```

Open the study launcher:

```text
http://127.0.0.1:3000/examples/demos/ai_vr_pressure/index.html
```

## Participant Output

Each condition page can export one local JSON log after a participant submits their answers. The log includes:

- Group-task answers.
- Individual-task answers, including selected person IDs and evidence tags.
- View usage, such as PCA or UMAP interaction.
- Total duration.
- Click counts.

## Scoring

Use the scoring helper with a participant submission JSON file:

```powershell
python tools/research/pressure_study_scoring.py `
  --study examples/demos/ai_vr_pressure/study_tasks.json `
  --submission <participant_log.json>
```

The script reports total score, maximum score, accuracy, score per minute, and task-by-task correctness.

## Files Intentionally Excluded From GitHub

The repository is configured to avoid uploading local research material and large artifacts such as:

- `issues/`
- `docs/plans/`
- `babiaxr-issues22.tar`

Keep raw reports, paper drafts, screenshots, archives, and large videos outside the Git history unless they are intentionally prepared for release.

## License And Attribution

This repository remains under the GPL-3.0 license because it is derived from BabiaXR `aframe-babia-components`.

Original BabiaXR copyright and license terms are preserved in `LICENSE`. Any redistribution of this modified version should keep the GPL-3.0 license and clearly acknowledge the BabiaXR upstream project.
