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

function main() {
  testParseCsvText();
  testComputePressureRange();
  testFindNearestPoint();
  console.log("study-common tests passed");
}

main();
