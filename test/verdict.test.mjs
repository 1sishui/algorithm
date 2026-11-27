// 算法诊断自测：强/中/弱判定、阈值可配置、边界与脏数据
//
// 为什么要有这个文件：
//   1. verdict.js 原来零测试覆盖，改了阈值没人知道有没有改坏别的东西
//   2. 「改配置后结果会变」这条验收标准，只有写成断言才算真的被验证过
//   3. 以后要把阈值从经验值换成校准值，有测试兜底才敢动
//
// 只测纯逻辑（buildCategoryStats）。renderVerdict 需要 document，属于浏览器侧，
// 不在本文件覆盖范围——那部分靠页面手测。
import assert from 'node:assert/strict';
import { buildCategoryStats } from '../src/ui/verdict.js';
import { VERDICT_CONFIG, CONFIG } from '../src/config.js';

/* ---------- 造数据：四个大类，覆盖 强 / 中 / 弱 三种判定 ---------- */

/** @type {Array<Object>} 洛谷提交记录（形状和 normalizeRecords 的输出一致） */
const submissions = [];
/** @type {Record<string, {tags: string[]}>} 题目标签表 */
const pidTags = {};

/** 往 submissions 里塞「某题提交 n 次、最后一次是否通过」 */
function addProblem(pid, attempts, accepted, difficulty = 3, tag = null) {
  for (let i = 0; i < attempts; i += 1) {
    submissions.push({
      pid,
      difficulty,
      accepted: accepted && i === attempts - 1,
      status: 'AC',
      submittedAt: new Date(Date.UTC(2026, 9, 1, i)).toISOString()
    });
  }
  if (tag) pidTags[pid] = { tags: [tag], categories: [], checked: true };
}

// 动态规划：3 题全过，平均 2.0 次提交 → 通过率 100%、提交少 → 强
addProblem('P101', 1, true, 3, '背包');
addProblem('P102', 2, true, 4, '背包');
addProblem('P103', 3, true, 3, '线性动规');

// 图论：3 题全没过 → 通过率 0% → 弱
addProblem('P201', 2, false, 4, '最短路');
addProblem('P202', 3, false, 5, '最短路');
addProblem('P203', 4, false, 4, '最小生成树');

// 字符串：2 题全过，但每题交了 3 次 → 通过率高、提交不少 → 中
addProblem('P301', 3, true, 3, 'KMP');
addProblem('P302', 3, true, 4, 'KMP');

// 没抓到标签的题（应该被完全跳过，不能进「其他」）
addProblem('P999', 1, true, 6, null);

const tagEntry = (pid) => pidTags[pid] || { tags: [] };

/* ---------- 1. 基本结构 ---------- */

const stats = buildCategoryStats(submissions, pidTags, tagEntry);
assert.equal(stats.length, 3, '无标签的题应该被跳过，只剩 3 个大类');

const byName = Object.fromEntries(stats.map((item) => [item.category, item]));
assert.ok(byName['动态规划'] && byName['图论'] && byName['字符串'], '三个大类都要在');

/* ---------- 2. 默认阈值下的判定 ---------- */

assert.equal(byName['动态规划'].level, '强', '通过率 100% 且平均 2.0 次 → 强');
assert.equal(byName['图论'].level, '弱', '通过率 0% → 弱');
assert.equal(byName['字符串'].level, '中', '通过率 100% 但平均 3.0 次 → 不够干脆，判中（一好一平）');

// 明细数值也算对，避免判定对但统计错
assert.equal(byName['动态规划'].problems, 3);
assert.equal(byName['动态规划'].solved, 3);
assert.equal(byName['动态规划'].rate, 1);
assert.equal(byName['动态规划'].avgAttempts, 2);
assert.equal(byName['图论'].rate, 0);
assert.equal(byName['图论'].avgAttempts, 3);

/* ---------- 3. 排序：最弱的排最前，方便用户一眼看到短板 ---------- */

assert.equal(stats[0].category, '图论', '通过率最低的排最前');
assert.equal(stats[2].category, '动态规划', '通过率相同的，平均提交少的排后面');

/* ---------- 4. 阈值可配置：改配置，结论必须跟着变 ---------- */

// 4.1 把「强」的平均提交上限收紧到 1.5 → 动态规划（2.0 次）掉到「中」
const strictStrong = buildCategoryStats(submissions, pidTags, tagEntry, { strongMaxAttempts: 1.5 });
assert.equal(
  strictStrong.find((item) => item.category === '动态规划').level,
  '中',
  'strongMaxAttempts 收紧后，平均 2.0 次的不该再判强'
);

// 4.2 把「弱」的平均提交下限放宽到 3 → 字符串（3.0 次）从「中」变「弱」
const strictWeak = buildCategoryStats(submissions, pidTags, tagEntry, { weakMinAttempts: 3 });
assert.equal(
  strictWeak.find((item) => item.category === '字符串').level,
  '弱',
  'weakMinAttempts 放宽后，平均 3.0 次的应该判弱'
);

// 4.3 把强判定放宽 → 字符串（通过率 100%、3.0 次）也能变强
const loose = buildCategoryStats(submissions, pidTags, tagEntry, { strongMaxAttempts: 3 });
assert.equal(
  loose.find((item) => item.category === '字符串').level,
  '强',
  'strongMaxAttempts 放宽后，平均 3.0 次也应该能判强'
);

// 4.4 只传部分覆盖项，其余必须仍然取 config.js 的默认值（不能变成 undefined）
const partial = buildCategoryStats(submissions, pidTags, tagEntry, { maxCategories: 1 });
assert.equal(
  partial.find((item) => item.category === '图论').level,
  '弱',
  '只覆盖一个字段时，其余阈值仍应生效（否则会变成 undefined 比较）'
);

/* ---------- 5. 边界：等于阈值时必须算「满足」（闭区间） ---------- */

// 造一个「通过率恰好 0.7、平均提交恰好 2.2」的大类：10 题 7 过，总提交 22 次
submissions.length = 0;
for (const key of Object.keys(pidTags)) delete pidTags[key];
// 6 题各 2 次通过 + 1 题 3 次通过 = 15 次；3 题没过，分别 3/2/2 次 = 7 次；合计 22 次
[2, 2, 2, 2, 2, 2, 3].forEach((n, i) => addProblem('E10' + i, n, true, 3, '枚举'));
[3, 2, 2].forEach((n, i) => addProblem('E20' + i, n, false, 3, '枚举'));

const boundary = buildCategoryStats(submissions, pidTags, tagEntry);
const edge = boundary[0];
assert.equal(edge.rate, 0.7, '通过率应恰好是 0.7');
assert.equal(edge.avgAttempts, 2.2, '平均提交应恰好是 2.2');
assert.equal(edge.level, '强', '等于阈值时应判强（>= 与 <= 都是闭区间）');

/* ---------- 6. 一道题多个标签跨大类时，两边都算 ---------- */

submissions.length = 0;
for (const key of Object.keys(pidTags)) delete pidTags[key];
addProblem('M1', 1, true, 3, '背包');
pidTags['M1'] = { tags: ['背包', '最短路'], categories: [], checked: true };

const multi = buildCategoryStats(submissions, pidTags, tagEntry);
assert.equal(multi.length, 2, '跨大类的题应该同时计入两个大类');
assert.equal(multi.find((item) => item.category === '动态规划').problems, 1);
assert.equal(multi.find((item) => item.category === '图论').problems, 1);

/* ---------- 7. 空数据不崩 ---------- */

assert.deepEqual(buildCategoryStats([], {}, () => ({ tags: [] })), [], '没有提交记录时返回空数组');

/* ---------- 8. 展示项与判定项分离 ---------- */

assert.equal(VERDICT_CONFIG.maxCategories, 12, '默认最多显示 12 个大类');
assert.equal(CONFIG.verdict, VERDICT_CONFIG, 'CONFIG.verdict 应指向同一份配置');
assert.equal(
  buildCategoryStats(submissions, pidTags, tagEntry, { maxCategories: 1 }).length,
  2,
  'maxCategories 只影响渲染时的截断，不该影响统计结果'
);

/* ---------- 9. 每个大类都要能解释自己 ---------- */

for (const item of buildCategoryStats(submissions, pidTags, tagEntry)) {
  assert.ok(Array.isArray(item.topTags) && item.topTags.length <= 3, `${item.category} 的 topTags 应是最多 3 个`);
  assert.ok(item.solved <= item.problems, `${item.category} 的通过数不能超过题数`);
}

console.log('✅ 算法诊断自测通过：阈值可配置、边界、跨大类、空数据共 9 组检查');
