// 六维特征自测：纯函数，用构造数据验证公式方向与边界
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const f = await import(pathToFileURL(path.resolve('src/assessment/features.js')).href);

const CATALOG = [
  { name: '快速排序', category: '排序' },
  { name: '冒泡排序', category: '排序' },
  { name: '插入排序', category: '排序' },
  { name: '二叉树中序遍历', category: '树' }
];

const at = (minutes) => new Date(Date.UTC(2026, 10, 24, 10, minutes)).toISOString();

function run(minutes, over = {}) {
  return {
    at: at(minutes),
    algorithm: '快速排序',
    category: '排序',
    size: 7,
    steps: 20,
    comparisons: 10,
    swaps: 3,
    ms: 2,
    error: null,
    ...over
  };
}

// 1. 没有数据时六个维度都是 null，不编造数字
const empty = f.computeFeatures([]);
assert.equal(empty.sample, 0);
for (const dim of f.DIMENSIONS) {
  assert.equal(empty.dims[dim.key].value, null, `${dim.key} 应该为空`);
}

// 2. 出错后被改对 → 修正分高于没改对
const fixedRuns = [run(0, { error: '语法错误' }), run(1, { error: null })];
const unfixedRuns = [run(0, { error: '语法错误' }), run(1, { error: '又错了' })];
assert.ok(
  f.computeFeatures(fixedRuns, CATALOG).dims.fix.value > f.computeFeatures(unfixedRuns, CATALOG).dims.fix.value,
  '改对之后的修正分应该更高'
);

// 3. 用过的算法越多，多样性越高
const oneAlgo = [run(0), run(1), run(2)];
const manyAlgo = [
  run(0),
  run(1, { algorithm: '冒泡排序' }),
  run(2, { algorithm: '插入排序' }),
  run(3, { algorithm: '二叉树中序遍历', category: '树' })
];
assert.ok(
  f.computeFeatures(manyAlgo, CATALOG).dims.diversity.value >
    f.computeFeatures(oneAlgo, CATALOG).dims.diversity.value,
  '算法种类多，多样性应该更高'
);

// 4. 一次练习里运行越多轮，尝试模式分越高
const fewRuns = [run(0), run(60 * 3)];
const manyRuns = [run(0), run(1), run(2), run(3), run(4), run(5), run(6)];
assert.ok(
  f.computeFeatures(manyRuns, CATALOG).dims.attempt.value >
    f.computeFeatures(fewRuns, CATALOG).dims.attempt.value,
  '同一会话里迭代多，尝试分更高'
);

// 5. 间隔 30 分钟以上切成两次练习
const sessions = f.splitSessions([run(0), run(5), run(40), run(45)]);
assert.equal(sessions.length, 2);
assert.equal(sessions[0].length, 2);

// 6. 规模递增 → 难度爬升 > 50；递减 → < 50
const up = [run(0, { size: 5 }), run(1, { size: 10 }), run(2, { size: 20 }), run(3, { size: 40 })];
const down = [run(0, { size: 40 }), run(1, { size: 20 }), run(2, { size: 10 }), run(3, { size: 5 })];
assert.ok(f.computeFeatures(up, CATALOG).dims.slope.value > 50, '规模递增应大于 50');
assert.ok(f.computeFeatures(down, CATALOG).dims.slope.value < 50, '规模递减应小于 50');

// 7. 少于 3 次有规模的运行，爬升维度给 null 而不是瞎猜
const tiny = f.computeFeatures([run(0), run(1)], CATALOG);
assert.equal(tiny.dims.slope.value, null);

// 8. 只练一个类别 → 覆盖均衡明显低于练多个类别
const singleCat = [run(0), run(1), run(2)];
const multiCat = [
  run(0),
  run(1, { algorithm: '二叉树中序遍历', category: '树' }),
  run(2),
  run(3, { algorithm: '二叉树中序遍历', category: '树' })
];
assert.ok(
  f.computeFeatures(singleCat, CATALOG).dims.coverage.value < f.computeFeatures(multiCat, CATALOG).dims.coverage.value,
  '两个类别的覆盖均衡应该更高'
);

// 9. 每个维度都有可读的解释
const full = f.computeFeatures(multiCat, CATALOG);
for (const dim of f.DIMENSIONS) {
  assert.ok(full.dims[dim.key].detail && full.dims[dim.key].detail.length > 0, `${dim.key} 缺少解释`);
}

// 10. 置信度随样本量上升
assert.ok(f.computeFeatures(oneAlgo, CATALOG).confidence < f.computeFeatures(manyAlgo.concat(manyAlgo), CATALOG).confidence);

console.log('✅ 六维特征自测通过：10 项检查');