const assert = require("assert");
const path = require("path");

const mod = require(path.join(__dirname, "study-common.js"));
const internal = mod._internal;

function testParseCsvText() {
  const csv = "PersonID,Pressure_Index_clip,PCA1,PCA2\nPID_1,0.8,1.2,-0.1\nPID_2,0.6,-0.4,0.3\n";
  const rows = internal.parseCsvText(csv);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].PersonID, "PID_1");
  assert.strictEqual(rows[0].Pressure_Index_clip, 0.8);
  assert.strictEqual(rows[1].PCA1, -0.4);
}

function testComputePressureRange() {
  const rows = [
    { Pressure_Index_clip: 0.5 },
    { Pressure_Index_clip: 0.9 },
    { Pressure_Index_clip: 0.7 },
  ];
  const r = internal.computePressureRange(rows);
  assert.deepStrictEqual(r, { min: 0.5, max: 0.9 });
}

function testFindNearestPoint() {
  const points = [
    { x: 10, y: 10, PersonID: "A" },
    { x: 100, y: 100, PersonID: "B" },
  ];
  const p = internal.findNearestPoint(points, 8, 12);
  assert.strictEqual(p.PersonID, "A");
}

function testNormalizeByQuantileUsesBounds() {
  const rows = [
    { Income: 10 },
    { Income: 20 },
    { Income: 30 },
    { Income: 40 },
    { Income: 1000 },
  ];
  const bounds = internal.getQuantileBounds(rows, "Income", 0.1, 0.9);
  assert.strictEqual(bounds.min, 14);
  assert(Math.abs(bounds.max - 616) < 1e-9);
  assert.strictEqual(internal.normalizeWithBounds(14, bounds), 0);
  assert(Math.abs(internal.normalizeWithBounds(616, bounds) - 1) < 1e-9);
  assert.strictEqual(internal.normalizeWithBounds(1000, bounds), 1);
}

function testFilterMatchUsesOrWithinAndAcross() {
  const row = { Occupation: "Student", City_Tier: "Tier_1" };
  const filters = {
    occupations: ["Student", "Professional"],
    cityTiers: ["Tier_1", "Tier_2"],
  };
  const missCity = {
    occupations: ["Student", "Professional"],
    cityTiers: ["Tier_3"],
  };
  const missOcc = {
    occupations: ["Retired"],
    cityTiers: ["Tier_1", "Tier_2"],
  };
  assert.strictEqual(internal.matchesStudyFilters(row, filters), true);
  assert.strictEqual(internal.matchesStudyFilters(row, missCity), false);
  assert.strictEqual(internal.matchesStudyFilters(row, missOcc), false);
}

function testCombinedColorMixesIncomeAndPressure() {
  const c1 = internal.computeCombinedColor(0, 0);
  const c2 = internal.computeCombinedColor(1, 0);
  const c3 = internal.computeCombinedColor(1, 1);
  assert.strictEqual(c1.toLowerCase(), "#330000");
  assert.strictEqual(c2.toLowerCase(), "#ff0000");
  assert.strictEqual(c3.toLowerCase(), "#ffd400");
}

function main() {
  testParseCsvText();
  testComputePressureRange();
  testFindNearestPoint();
  testNormalizeByQuantileUsesBounds();
  testFilterMatchUsesOrWithinAndAcross();
  testCombinedColorMixesIncomeAndPressure();
  console.log("study-common tests passed");
}

main();
