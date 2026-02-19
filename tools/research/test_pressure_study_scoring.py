import json
import tempfile
import unittest
from pathlib import Path


def _load_module():
    import importlib.util

    module_path = Path(__file__).with_name("pressure_study_scoring.py")
    spec = importlib.util.spec_from_file_location("pressure_study_scoring", module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


class PressureStudyScoringTests(unittest.TestCase):
    def setUp(self):
        self.module = _load_module()
        self.study = {
            "study_id": "pressure_ai_vr_v1",
            "tasks": [
                {
                    "id": "t1",
                    "type": "single_choice",
                    "weight": 2.0,
                    "correct_answer": "City_Tier",
                },
                {
                    "id": "t2",
                    "type": "single_choice",
                    "weight": 1.0,
                    "correct_answer": "Tier_1_higher_than_Tier_2",
                },
                {
                    "id": "t3",
                    "type": "multi_choice",
                    "weight": 2.0,
                    "correct_answer": ["Tier_1|Retired", "Tier_1|Student"],
                },
            ],
        }
        self.study_dual = {
            "study_id": "pressure_ai_vr_v2",
            "group_endpoint": {
                "weight": 0.6,
                "tasks": [
                    {
                        "id": "g1",
                        "type": "single_choice",
                        "weight": 1.0,
                        "correct_answer": "Tier_1",
                    },
                    {
                        "id": "g2",
                        "type": "multi_choice",
                        "weight": 1.0,
                        "correct_answer": ["Tier_1|Retired", "Tier_1|Student"],
                    },
                ],
            },
            "individual_endpoint": {
                "weight": 0.4,
                "top_candidates": ["PID_TOP1", "PID_TOP2", "PID_TOP3"],
                "required_evidence_count": 2,
                "evidence_options": [
                    "City_Tier",
                    "Occupation",
                    "Dependents_Group",
                    "Savings_Rate_clip",
                    "Pressure_Index_clip",
                ],
                "evidence_score_each": 1.0,
                "rank_scores": {"top1": 2.0, "top23": 1.0, "miss": 0.0},
                "time_bonus": [
                    {"max_seconds": 180, "bonus": 0.6},
                    {"max_seconds": 300, "bonus": 0.3},
                ],
            },
        }

    def test_score_answers_exact_match(self):
        answers = {
            "t1": "City_Tier",
            "t2": "Tier_1_higher_than_Tier_2",
            "t3": ["Tier_1|Student", "Tier_1|Retired"],
        }
        result = self.module.score_answers(self.study, answers)
        self.assertEqual(result["max_score"], 5.0)
        self.assertEqual(result["score"], 5.0)
        self.assertAlmostEqual(result["accuracy"], 1.0, places=6)

    def test_score_answers_partial_and_wrong(self):
        answers = {
            "t1": "Occupation",
            "t2": "Tier_1_higher_than_Tier_2",
            "t3": ["Tier_1|Retired", "Tier_2|Self_Employed"],
        }
        result = self.module.score_answers(self.study, answers)
        self.assertEqual(result["max_score"], 5.0)
        self.assertEqual(result["score"], 1.0)
        self.assertAlmostEqual(result["accuracy"], 0.2, places=6)

    def test_score_submission_file_includes_efficiency(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            study_path = tmp_path / "study.json"
            submission_path = tmp_path / "submission.json"

            study_path.write_text(json.dumps(self.study), encoding="utf-8")
            submission = {
                "participant_id": "P001",
                "condition_id": "vr_ai_on",
                "duration_seconds": 300,
                "answers": {
                    "t1": "City_Tier",
                    "t2": "Tier_1_higher_than_Tier_2",
                    "t3": ["Tier_1|Student", "Tier_1|Retired"],
                },
            }
            submission_path.write_text(json.dumps(submission), encoding="utf-8")

            result = self.module.score_submission_file(submission_path, study_path)
            self.assertEqual(result["participant_id"], "P001")
            self.assertEqual(result["condition_id"], "vr_ai_on")
            self.assertEqual(result["score"], 5.0)
            self.assertGreater(result["score_per_minute"], 0.0)
            self.assertIn("task_breakdown", result)

    def test_dual_endpoint_top1_and_fast_bonus(self):
        submission = {
            "participant_id": "P100",
            "condition_id": "vr_ai_on",
            "duration_seconds": 240,
            "answers": {
                "g1": "Tier_1",
                "g2": ["Tier_1|Student", "Tier_1|Retired"],
            },
            "individual": {
                "selected_person_id": "PID_TOP1",
                "evidence_tags": ["City_Tier", "Pressure_Index_clip"],
                "duration_seconds": 170,
            },
        }
        result = self.module.score_submission(submission, self.study_dual)
        self.assertIn("endpoint_scores", result)
        self.assertAlmostEqual(result["endpoint_scores"]["group"]["normalized_score"], 1.0, places=6)
        self.assertAlmostEqual(result["endpoint_scores"]["individual"]["normalized_score"], 1.0, places=6)
        self.assertAlmostEqual(result["score"], 1.0, places=6)

    def test_dual_endpoint_top3_partial_still_scored(self):
        submission = {
            "participant_id": "P101",
            "condition_id": "vr_ai_off",
            "duration_seconds": 420,
            "answers": {
                "g1": "Tier_1",
                "g2": ["Tier_1|Student", "Tier_1|Retired"],
            },
            "individual": {
                "selected_person_id": "PID_TOP2",
                "evidence_tags": ["Occupation", "Pressure_Index_clip"],
                "duration_seconds": 420,
            },
        }
        result = self.module.score_submission(submission, self.study_dual)
        self.assertAlmostEqual(result["endpoint_scores"]["individual"]["id_score"], 1.0, places=6)
        self.assertAlmostEqual(result["endpoint_scores"]["individual"]["time_bonus"], 0.0, places=6)
        self.assertGreater(result["score"], 0.8)

    def test_dual_endpoint_requires_exactly_two_evidence_tags(self):
        submission = {
            "participant_id": "P102",
            "condition_id": "2d_ai_on",
            "duration_seconds": 360,
            "answers": {
                "g1": "Tier_1",
                "g2": ["Tier_1|Student", "Tier_1|Retired"],
            },
            "individual": {
                "selected_person_id": "PID_TOP1",
                "evidence_tags": ["City_Tier", "Occupation", "Pressure_Index_clip"],
                "duration_seconds": 200,
            },
        }
        result = self.module.score_submission(submission, self.study_dual)
        self.assertFalse(result["endpoint_scores"]["individual"]["evidence_valid"])
        self.assertAlmostEqual(result["endpoint_scores"]["individual"]["evidence_score"], 0.0, places=6)


if __name__ == "__main__":
    unittest.main()
