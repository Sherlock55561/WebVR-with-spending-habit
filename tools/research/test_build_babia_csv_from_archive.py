import tempfile
import unittest
from pathlib import Path

import pandas as pd

from tools.research.build_babia_csv_from_archive import build_babia_dataset


class BuildBabiaCsvTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.input_csv = self.root / "data.csv"
        self.output_dir = self.root / "out"

        rows = []
        occupations = ["Self_Employed", "Retired", "Professional", "Student"]
        tiers = ["Tier_1", "Tier_2", "Tier_3"]
        dep_values = [0, 1, 2, 3, 4]

        for i in range(120):
            dep = dep_values[i % len(dep_values)]
            income = 30000 + (i * 40)
            rows.append(
                {
                    "Income": float(income),
                    "Age": int(22 + (i % 35)),
                    "Dependents": int(dep),
                    "Occupation": occupations[i % len(occupations)],
                    "City_Tier": tiers[i % len(tiers)],
                    "Rent": 7000 + (i % 11) * 23,
                    "Loan_Repayment": (i % 7) * 90,
                    "Insurance": 900 + (i % 5) * 11,
                    "Groceries": 2200 + (i % 9) * 17,
                    "Transport": 800 + (i % 8) * 14,
                    "Eating_Out": 500 + (i % 10) * 9,
                    "Entertainment": 480 + (i % 6) * 8,
                    "Utilities": 1200 + (i % 4) * 12,
                    "Healthcare": 700 + (i % 12) * 10,
                    "Education": (i % 3) * 60,
                    "Miscellaneous": 350 + (i % 13) * 6,
                    "Desired_Savings_Percentage": 10.0,
                    "Desired_Savings": 2500 + (i % 14) * 30,
                    "Disposable_Income": 0.0,
                    "Potential_Savings_Groceries": 0.0,
                    "Potential_Savings_Transport": 0.0,
                    "Potential_Savings_Eating_Out": 0.0,
                    "Potential_Savings_Entertainment": 0.0,
                    "Potential_Savings_Utilities": 0.0,
                    "Potential_Savings_Healthcare": 0.0,
                    "Potential_Savings_Education": 0.0,
                    "Potential_Savings_Miscellaneous": 0.0,
                }
            )

        pd.DataFrame(rows).to_csv(self.input_csv, index=False)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_build_outputs_required_files_and_columns(self):
        result = build_babia_dataset(self.input_csv, self.output_dir, random_state=42)

        self.assertEqual(result["rows_all"], 96)
        self.assertEqual(result["dependents_groups"], ["1", "2", "3", "4+"])

        all_file = self.output_dir / "babiaxr_all_dependents_groups.csv"
        self.assertTrue(all_file.exists())

        df = pd.read_csv(all_file)
        for col in [
            "PersonID",
            "Dependents_Group",
            "Pressure_Index_clip",
            "Savings_Rate_clip",
            "Cluster_KMeans",
            "Cluster_GMM",
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
        ]:
            self.assertIn(col, df.columns)

        self.assertEqual(set(df["Dependents_Group"].astype(str).unique()), {"1", "2", "3", "4+"})

        for name in ["1", "2", "3", "4+"]:
            self.assertTrue((self.output_dir / f"babiaxr_dependents_{name}.csv").exists())


if __name__ == "__main__":
    unittest.main()
