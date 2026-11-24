// 洛谷导入与做题特征自测：字段容错、统计、六维口径
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const luogu = await import(pathToFileURL(path.resolve('src/import/luogu.js')).href);
const sub = await import(pathToFileURL(path.resolve('src/assessment/submissions.js')).href);

/* ---------- 1. 字段容错 ---------- */
const mixed = [
  { id: 1, problem: { pid: 'P1001', title: 'A+B', difficulty: 1 }, status: 12, submitTime: 1700000000, language: 'C++' },
  { id: 2, pid: 'P1002', title: '过河卒', difficulty: 3, status: 7, time: '2023-11-15T10:00:00Z', lang: 'C++' },
  { id: 3, problemId: 'P1003', verdict: 'Accepted', difficulty: 2, timestamp: 1700100000000 }
];

const normalized = luogu.normalizeRecords(mixed);
assert.equal(normalized.length, 3);
assert.equal(normalized[0].pid, 'P1001');
assert.equal(normalized[0].accepted, true);
assert.equal(normalized[1].accepted, false);
assert.equal(normalized[1].status, '答案错误');
assert.equal(normalized[2].accepted, true, 'verdict=Accepted 也要认');
assert.ok(normalized[0].submittedAt.startsWith('2023-11-14'), '秒级时间戳要换算正确');
assert.ok(normalized.every((r, i, arr) => i === 0 || r.submittedAt >= arr[i - 1].submittedAt), '应按时间排序');

/* ---------- 2. 脏数据不崩 ---------- */
assert.deepEqual(luogu.normalizeRecords(null), []);
assert.deepEqual(luogu.normalizeRecords([null, 1, 'x', {}]), []);
assert.equal(luogu.normalizeRecords([{ id: 9 }]).length, 0, '没有 pid 也没有时间 → 丢弃');

/* ---------- 3. 去重 ---------- */
const dup = luogu.normalizeRecords([mixed[0], mixed[0]]);
assert.equal(dup.length, 1, '同一条提交不应重复计入');

/* ---------- 4. 统计 ---------- */
const stats = luogu.summarizeSubmissions(normalized);
assert.equal(stats.submissions, 3);
assert.equal(stats.problems, 3);
assert.equal(stats.solved, 2);
assert.equal(Math.round(stats.acceptRate * 100), 67);
assert.equal(stats.histogram[1], 1);
assert.equal(stats.histogram[3], 1);

/* ---------- 5. 按题聚合 ---------- */
const grouped = sub.groupByProblem(normalized);
assert.equal(grouped.length, 3);
const p1001 = grouped.find((g) => g.pid === 'P1001');
assert.equal(p1001.attempts, 1);
assert.equal(p1001.accepted, true);

/* ---------- 6. 六维：一次就通过的，修正分高 ---------- */
const easy = sub.computeSubmissionFeatures([
  { pid: 'A', accepted: true, difficulty: 1, submittedAt: '2026-01-01T00:00:00Z', language: 'C++' },
  { pid: 'B', accepted: true, difficulty: 1, submittedAt: '2026-01-02T00:00:00Z', language: 'C++' }
]);
const hard = sub.computeSubmissionFeatures([
  { pid: 'A', accepted: true, difficulty: 1, submittedAt: '2026-01-01T00:00:00Z', language: 'C++' },
  { pid: 'A', accepted: false, difficulty: 1, submittedAt: '2026-01-01T01:00:00Z', language: 'C++' },
  { pid: 'A', accepted: false, difficulty: 1, submittedAt: '2026-01-01T02:00:00Z', language: 'C++' },
  { pid: 'A', accepted: false, difficulty: 1, submittedAt: '2026-01-01T03:00:00Z', language: 'C++' }
]);
assert.ok(easy.dims.fix.value > hard.dims.fix.value, '一次通过应该比反复提交得分高');

/* ---------- 7. 没通过的题会拉低修正分 ---------- */
const unsolved = sub.computeSubmissionFeatures([
  { pid: 'C', accepted: false, difficulty: 2, submittedAt: '2026-01-01T00:00:00Z', language: 'C++' }
]);
assert.ok(unsolved.dims.fix.value <= 20);

/* ---------- 8. 难度越杂，覆盖越均衡 ---------- */
const narrow = sub.computeSubmissionFeatures([
  { pid: 'A', accepted: true, difficulty: 2, submittedAt: '2026-01-01T00:00:00Z' },
  { pid: 'B', accepted: true, difficulty: 2, submittedAt: '2026-01-02T00:00:00Z' }
]);
const wide = sub.computeSubmissionFeatures([
  { pid: 'A', accepted: true, difficulty: 1, submittedAt: '2026-01-01T00:00:00Z' },
  { pid: 'B', accepted: true, difficulty: 4, submittedAt: '2026-01-02T00:00:00Z' }
]);
assert.ok(wide.dims.coverage.value > narrow.dims.coverage.value);

/* ---------- 9. 难度上升 → 爬升分 > 50 ---------- */
const rising = sub.computeSubmissionFeatures([
  { pid: 'A', accepted: true, difficulty: 1, submittedAt: '2026-01-01T00:00:00Z' },
  { pid: 'B', accepted: true, difficulty: 2, submittedAt: '2026-01-02T00:00:00Z' },
  { pid: 'C', accepted: true, difficulty: 5, submittedAt: '2026-01-03T00:00:00Z' },
  { pid: 'D', accepted: true, difficulty: 6, submittedAt: '2026-01-04T00:00:00Z' }
]);
assert.ok(rising.dims.slope.value > 50, `难度上升时爬升分应 >50，实际 ${rising.dims.slope.value}`);

/* ---------- 10. 每个维度都有“洛谷”来源说明 ---------- */
for (const key of ['fix', 'transfer', 'diversity', 'attempt', 'coverage']) {
  assert.match(rising.dims[key].detail, /^洛谷：/, `${key} 缺少来源说明`);
}
assert.equal(sub.computeSubmissionFeatures([]), null);

console.log('✅ 洛谷导入与做题特征自测通过：10 组检查');