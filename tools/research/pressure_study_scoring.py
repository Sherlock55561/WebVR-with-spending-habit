"""
Scoring utilities for 2D/VR + AI pressure-analysis experiments.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def load_json(path: str | Path) -> dict[str, Any]:
    file_path = Path(path)
    return json.loads(file_path.read_text(encoding="utf-8"))


def _normalize_answer(task_type: str, value: Any) -> Any:
    if task_type == "multi_choice":
        if value is None:
            return []
        if isinstance(value, list):
            return sorted(str(v) for v in value)
        return sorted([str(value)])
    if value is None:
        return ""
    return str(value)


def score_answers(study_definition: dict[str, Any], answers: dict[str, Any]) -> dict[str, Any]:
    tasks = study_definition.get("tasks", [])
    return _score_task_list(tasks, answers)


def _score_task_list(tasks: list[dict[str, Any]], answers: dict[str, Any]) -> dict[str, Any]:
    total_score = 0.0
    max_score = 0.0
    breakdown = []

    for task in tasks:
        task_id = task["id"]
        task_type = task.get("type", "single_choice")
        weight = float(task.get("weight", 1.0))
        max_score += weight

        expected = _normalize_answer(task_type, task.get("correct_answer"))
        actual = _normalize_answer(task_type, answers.get(task_id))
        is_correct = actual == expected
        score = weight if is_correct else 0.0
        total_score += score

        breakdown.append(
            {
                "task_id": task_id,
                "type": task_type,
                "weight": weight,
                "expected": expected,
                "actual": actual,
                "is_correct": bool(is_correct),
                "score": score,
            }
        )

    accuracy = 0.0 if max_score == 0 else total_score / max_score
    return {
        "score": float(total_score),
        "max_score": float(max_score),
        "accuracy": float(accuracy),
        "task_breakdown": breakdown,
    }


def _score_individual_endpoint(
    individual_submission: dict[str, Any],
    individual_spec: dict[str, Any],
    submission_duration_seconds: float,
) -> dict[str, Any]:
    top_candidates = [str(x) for x in individual_spec.get("top_candidates", [])]
    rank_scores = individual_spec.get("rank_scores", {})
    top1_score = float(rank_scores.get("top1", 2.0))
    top23_score = float(rank_scores.get("top23", 1.0))
    miss_score = float(rank_scores.get("miss", 0.0))

    selected_person_id = str(individual_submission.get("selected_person_id", "") or "")
    if top_candidates and selected_person_id == top_candidates[0]:
        id_score = top1_score
        id_rank = "top1"
    elif selected_person_id and selected_person_id in top_candidates[1:]:
        id_score = top23_score
        id_rank = "top23"
    else:
        id_score = miss_score
        id_rank = "miss"

    required_count = int(individual_spec.get("required_evidence_count", 2))
    evidence_options = {str(x) for x in individual_spec.get("evidence_options", [])}
    evidence_score_each = float(individual_spec.get("evidence_score_each", 1.0))
    evidence_tags = individual_submission.get("evidence_tags", [])
    if not isinstance(evidence_tags, list):
        evidence_tags = [evidence_tags] if evidence_tags else []
    evidence_tags = [str(x) for x in evidence_tags]

    evidence_valid = (
        len(evidence_tags) == required_count
        and len(set(evidence_tags)) == required_count
        and all(tag in evidence_options for tag in evidence_tags)
    )
    evidence_score = float(required_count * evidence_score_each) if evidence_valid else 0.0

    duration_seconds = float(
        individual_submission.get("duration_seconds", submission_duration_seconds) or 0.0
    )
    time_bonus = 0.0
    time_bonus_rules = individual_spec.get("time_bonus", [])
    if isinstance(time_bonus_rules, list):
        normalized_rules = sorted(
            [
                (
                    float(rule.get("max_seconds", 0.0)),
                    float(rule.get("bonus", 0.0)),
                )
                for rule in time_bonus_rules
                if isinstance(rule, dict)
            ],
            key=lambda item: item[0],
        )
        for max_seconds, bonus in normalized_rules:
            if max_seconds > 0 and duration_seconds <= max_seconds:
                time_bonus = bonus
                break

    raw_score = float(id_score + evidence_score + time_bonus)
    max_bonus = 0.0
    if isinstance(time_bonus_rules, list):
        for rule in time_bonus_rules:
            if isinstance(rule, dict):
                max_bonus = max(max_bonus, float(rule.get("bonus", 0.0)))
    max_score = float(max(top1_score, top23_score, miss_score) + (required_count * evidence_score_each) + max_bonus)
    normalized_score = 0.0 if max_score == 0 else raw_score / max_score

    return {
        "selected_person_id": selected_person_id,
        "id_rank": id_rank,
        "id_score": float(id_score),
        "evidence_tags": evidence_tags,
        "evidence_valid": bool(evidence_valid),
        "evidence_score": float(evidence_score),
        "time_bonus": float(time_bonus),
        "raw_score": raw_score,
        "max_score": max_score,
        "normalized_score": float(normalized_score),
        "duration_seconds": duration_seconds,
    }


def _score_dual_endpoint_submission(
    submission: dict[str, Any],
    study_definition: dict[str, Any],
) -> dict[str, Any]:
    group_spec = study_definition.get("group_endpoint", {}) or {}
    individual_spec = study_definition.get("individual_endpoint", {}) or {}
    group_weight = float(group_spec.get("weight", 0.6))
    individual_weight = float(individual_spec.get("weight", 0.4))

    answers = submission.get("answers", {})
    group_tasks = group_spec.get("tasks", []) or []
    group_result = _score_task_list(group_tasks, answers)
    group_raw = float(group_result["score"])
    group_max = float(group_result["max_score"])
    group_normalized = 0.0 if group_max == 0 else group_raw / group_max

    duration_seconds = float(submission.get("duration_seconds", 0.0) or 0.0)
    individual_submission = submission.get("individual", {}) or {}
    individual_result = _score_individual_endpoint(
        individual_submission=individual_submission,
        individual_spec=individual_spec,
        submission_duration_seconds=duration_seconds,
    )

    weight_sum = group_weight + individual_weight
    final_score = 0.0
    if weight_sum > 0:
        final_score = (
            (group_normalized * group_weight) + (individual_result["normalized_score"] * individual_weight)
        ) / weight_sum

    return {
        "study_id": study_definition.get("study_id", ""),
        "participant_id": submission.get("participant_id", ""),
        "condition_id": submission.get("condition_id", ""),
        "duration_seconds": duration_seconds,
        "duration_minutes": duration_seconds / 60.0 if duration_seconds > 0 else 0.0,
        "score": float(final_score),
        "max_score": 1.0,
        "accuracy": float(final_score),
        "task_breakdown": group_result["task_breakdown"],
        "endpoint_scores": {
            "group": {
                "weight": float(group_weight),
                "raw_score": float(group_raw),
                "max_score": float(group_max),
                "normalized_score": float(group_normalized),
                "task_breakdown": group_result["task_breakdown"],
            },
            "individual": {
                "weight": float(individual_weight),
                **individual_result,
            },
        },
    }


def score_submission(
    submission: dict[str, Any],
    study_definition: dict[str, Any],
) -> dict[str, Any]:
    has_dual_endpoint = (
        isinstance(study_definition.get("group_endpoint"), dict)
        and isinstance(study_definition.get("individual_endpoint"), dict)
    )
    if has_dual_endpoint:
        out = _score_dual_endpoint_submission(submission, study_definition)
        duration_minutes = out["duration_minutes"]
        out["score_per_minute"] = (
            out["score"] / duration_minutes if duration_minutes > 0 else 0.0
        )
        return out

    answers = submission.get("answers", {})
    result = score_answers(study_definition, answers)

    duration_seconds = float(submission.get("duration_seconds", 0.0) or 0.0)
    duration_minutes = duration_seconds / 60.0 if duration_seconds > 0 else 0.0
    score_per_minute = (
        result["score"] / duration_minutes if duration_minutes > 0 else 0.0
    )

    out = {
        "study_id": study_definition.get("study_id", ""),
        "participant_id": submission.get("participant_id", ""),
        "condition_id": submission.get("condition_id", ""),
        "duration_seconds": duration_seconds,
        "duration_minutes": duration_minutes,
        "score": result["score"],
        "max_score": result["max_score"],
        "accuracy": result["accuracy"],
        "score_per_minute": float(score_per_minute),
        "task_breakdown": result["task_breakdown"],
    }
    return out


def score_submission_file(
    submission_path: str | Path,
    study_definition_path: str | Path,
) -> dict[str, Any]:
    submission = load_json(submission_path)
    study = load_json(study_definition_path)
    return score_submission(submission, study)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Score one pressure-study submission JSON.")
    parser.add_argument("--study", required=True, help="Path to study_tasks.json")
    parser.add_argument("--submission", required=True, help="Path to one participant submission json")
    parser.add_argument(
        "--output",
        default="",
        help="Optional path to write score json. If empty, prints to stdout only.",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    result = score_submission_file(args.submission, args.study)
    payload = json.dumps(result, indent=2, ensure_ascii=False)
    print(payload)
    if args.output:
        Path(args.output).write_text(payload, encoding="utf-8")


if __name__ == "__main__":
    main()
