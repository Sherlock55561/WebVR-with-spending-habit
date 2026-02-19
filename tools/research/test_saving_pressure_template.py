import json
import tempfile
import unittest
from pathlib import Path

import pandas as pd


def _load_module():
    import importlib.util

    module_path = Path(__file__).with_name("saving_pressure_template.py")
    spec = importlib.util.spec_from_file_location("saving_pressure_template", module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


class SavingPressureTemplateTests(unittest.TestCase):
    def setUp(self):
        self.module = _load_module()

    def _mock_frame(self, n, dep_group):
        city = ["Tier_1", "Tier_2", "Tier_3", "Tier_1"][:n]
        occ = ["Student", "Professional", "Retired", "Self_Employed"][:n]
        income = [20000, 35000, 50000, 42000][:n]
        age = [25, 35, 45, 31][:n]
        pressure = [0.9, 0.75, 0.65, 0.88][:n]
        saving = [0.06, 0.09, 0.12, 0.07][:n]
        return pd.DataFrame(
            {
                "PersonID": [f"P{dep_group}_{i}" for i in range(n)],
                "Income": income,
                "Age": age,
                "Dependents": [int(dep_group.replace("+", "")) if dep_group != "4+" else 4] * n,
                "Occupation": occ,
                "City_Tier": city,
                "Dependents_Group": [dep_group] * n,
                "Savings_Rate_clip": saving,
                "Pressure_Index_clip": pressure,
            }
        )

    def test_load_dataset_combines_default_group_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            file_map = {
                "babiaxr_dependents_1.csv": self._mock_frame(3, "1"),
                "babiaxr_dependents_2.csv": self._mock_frame(3, "2"),
                "babiaxr_dependents_3.csv": self._mock_frame(3, "3"),
                "babiaxr_dependents_4+.csv": self._mock_frame(3, "4+"),
            }
            for name, frame in file_map.items():
                frame.to_csv(tmp_path / name, index=False)

            df = self.module.load_dataset(tmp_path)
            self.assertEqual(len(df), 12)
            self.assertIn("source_file", df.columns)
            self.assertEqual(sorted(df["Dependents_Group"].astype(str).unique().tolist()), ["1", "2", "3", "4+"])

    def test_compute_effect_ranges_returns_factor_ranges(self):
        df = pd.DataFrame(
            {
                "City_Tier": ["Tier_1", "Tier_1", "Tier_2", "Tier_2", "Tier_3", "Tier_3"],
                "Occupation": ["A", "B", "A", "B", "A", "B"],
                "Pressure_Index_clip": [0.90, 0.89, 0.75, 0.76, 0.62, 0.63],
            }
        )
        ranges = self.module.compute_effect_ranges(df, "Pressure_Index_clip", ["City_Tier", "Occupation"])
        self.assertEqual(set(ranges["factor"].tolist()), {"City_Tier", "Occupation"})
        city_range = float(ranges.loc[ranges["factor"] == "City_Tier", "range"].iloc[0])
        occ_range = float(ranges.loc[ranges["factor"] == "Occupation", "range"].iloc[0])
        self.assertGreater(city_range, occ_range)

    def test_fit_ols_numpy_returns_valid_r2_and_coefficients(self):
        df = pd.DataFrame(
            {
                "Dependents_Group": ["1", "1", "2", "2", "3", "3"],
                "City_Tier": ["Tier_1", "Tier_2", "Tier_1", "Tier_2", "Tier_1", "Tier_2"],
                "Occupation": ["Student", "Student", "Professional", "Professional", "Retired", "Retired"],
                "Income": [20000, 40000, 25000, 45000, 30000, 50000],
                "Age": [25, 35, 30, 40, 45, 55],
                "Pressure_Index_clip": [0.90, 0.75, 0.88, 0.73, 0.86, 0.71],
            }
        )
        coeffs, r2 = self.module.fit_ols_numpy(
            df=df,
            target="Pressure_Index_clip",
            categorical=["Dependents_Group", "City_Tier", "Occupation"],
            numeric=["Income", "Age"],
        )
        self.assertGreaterEqual(r2, 0.0)
        self.assertLessEqual(r2, 1.0)
        self.assertIn("feature", coeffs.columns)
        self.assertIn("coefficient", coeffs.columns)
        self.assertTrue(any("City_Tier" in f for f in coeffs["feature"].tolist()))

    def test_run_analysis_writes_expected_outputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            out_dir = tmp_path / "out"
            for dep in ["1", "2", "3", "4+"]:
                self._mock_frame(4, dep).to_csv(tmp_path / f"babiaxr_dependents_{dep}.csv", index=False)

            summary = self.module.run_analysis(tmp_path, out_dir)
            self.assertIn("row_count", summary)
            self.assertTrue((out_dir / "summary.json").exists())
            self.assertTrue((out_dir / "effect_ranges_pressure.csv").exists())
            self.assertTrue((out_dir / "effect_ranges_savings.csv").exists())
            self.assertTrue((out_dir / "ols_pressure_coefficients.csv").exists())
            self.assertTrue((out_dir / "ols_savings_coefficients.csv").exists())

            written = json.loads((out_dir / "summary.json").read_text(encoding="utf-8"))
            self.assertEqual(written["row_count"], summary["row_count"])


if __name__ == "__main__":
    unittest.main()
