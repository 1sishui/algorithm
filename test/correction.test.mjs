// 代码差异与「错误修正」分析自测
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const base = path.resolve('src/assessment');
const { compareCode } = await import(pathToFileURL(path.join(base, 'diff.js')).href);
const { analyzeCorrection } = await import(pathToFileURL(path.join(base, 'correction.js')).href);

const CODE_A = [
  'int main() {',
  '  int n; cin >> n;',
  '  for (int i = 0; i <= n; i++) sum += a[i];',
  '  cout << sum;',
  '}'
].join('\n');

const CODE_B = CODE_A.replace('i <= n', 'i < n'); // 一处边界修正
const CODE_C = [
  'int main() {',
  '  int n; cin >> n;',
  '  sort(a, a + n);',
  '  for (int i = 0; i < n; i++) cout << a[i] << " ";',
  '  return 0;',
  '}'
].join('\n');

// 1. 完全相同 → 相似度 1、微调
const same = compareCode(CODE_A, CODE_A);
assert.equal(same.similarity, 1);
assert.equal(same.level, '微调');
assert.equal(same.added, 0);
assert.equal(same.removed, 0);

// 2. 改一行 → 高相似度、局部修改
const oneLine = compareCode(CODE_A, CODE_B);
assert.ok(oneLine.similarity > 0.6, `改一行相似度应该高，实际 ${oneLine.similarity}`);
assert.ok(['微调', '局部修改'].includes(oneLine.level));

// 3. 整段重写 → 低相似度
const rewrite = compareCode(CODE_A, CODE_C);
assert.ok(rewrite.similarity < 0.5, `重写相似度应该低，实际 ${rewrite.similarity}`);
assert.equal(rewrite.level, '重写');

// 4. 空代码不崩
assert.equal(compareCode('', '').level, '重写');
assert.equal(compareCode(CODE_A, '').similarity, 0);

// 5. 缩进/空格变化不算改动
const reformatted = CODE_A.replace(/  /g, '    ');
assert.equal(compareCode(CODE_A, reformatted).similarity, 1);

/* ---------- 错误修正分析 ---------- */
const t = (min) => new Date(Date.UTC(2026, 0, 1, 10, min)).toISOString();

// 6. 小步修正逐步通过：质量分高
const goodRun = analyzeCorrection([
  { code: CODE_A, accepted: false, submittedAt: t(0) },
  { code: CODE_B, accepted: true, submittedAt: t(5) }
]);
assert.equal(goodRun.withCode, true);
assert.equal(goodRun.transitions, 1);
assert.ok(goodRun.smallEdits >= 1, '改一行应算小步修改');
assert.ok(goodRun.score > 80, `两次提交通过应得高分，实际 ${goodRun.score}`);

// 7. 30 秒内整段重写 → 标记疑似粘贴，分数被打折
const pasteRun = analyzeCorrection([
  { code: CODE_A, accepted: false, submittedAt: t(0) },
  { code: CODE_C, accepted: true, submittedAt: t(0.5) }
]);
assert.equal(pasteRun.suspected, 1);
assert.ok(pasteRun.score < goodRun.score, '疑似粘贴应低于自己改');

// 8. 没有代码 → 退回次数口径
const noCode = analyzeCorrection([
  { accepted: false, submittedAt: t(0) },
  { accepted: true, submittedAt: t(3) }
]);
assert.equal(noCode.withCode, false);
assert.ok(noCode.score > 80);

// 9. 一次就过 = 100
const oneShot = analyzeCorrection([{ code: CODE_B, accepted: true, submittedAt: t(0) }]);
assert.equal(oneShot.score, 100);

// 10. 始终没通过 = 0
const failed = analyzeCorrection([
  { code: CODE_A, accepted: false, submittedAt: t(0) },
  { code: CODE_B, accepted: false, submittedAt: t(8) }
]);
assert.equal(failed.score, 0);
assert.equal(failed.accepted, false);

// 11. 说明文字包含关键信息
assert.match(goodRun.detail, /提交/);
assert.match(pasteRun.detail, /粘贴/);

console.log('✅ 代码差异与错误修正自测通过：11 项检查');