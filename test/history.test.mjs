// 运行记录模块自测：纯函数 + 假 storage
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const h = await import(pathToFileURL(path.resolve('src/user/history.js')).href);

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k)
  };
}

// 1. 新记录插在最前，并截断到上限
let list = [];
for (let i = 0; i < 60; i++) {
  list = h.pushRecord(list, { steps: i });
}
assert.equal(list.length, h.MAX_RECORDS);
assert.equal(list[0].steps, 59, '最新一条应该在头部');

// 2. 统计只算成功的
const stats = h.summarize([
  { steps: 10, comparisons: 4, error: null },
  { steps: 20, comparisons: 6, error: null },
  { steps: 0, comparisons: 0, error: '语法错误' }
]);
assert.equal(stats.count, 3);
assert.equal(stats.errors, 1);
assert.equal(stats.avgSteps, 15);
assert.equal(stats.avgComparisons, 5);

// 3. 空列表不炸
assert.deepEqual(h.summarize([]), { count: 0, errors: 0, avgComparisons: 0, avgSteps: 0 });

// 4. 存取往返
const storage = fakeStorage();
h.saveRecords(storage, [{ steps: 3, algorithm: '快速排序' }]);
const loaded = h.loadRecords(storage);
assert.equal(loaded.length, 1);
assert.equal(loaded[0].algorithm, '快速排序');

// 5. 存坏数据不炸
storage.setItem(h.STORAGE_KEY, '{oops');
assert.deepEqual(h.loadRecords(storage), []);

// 6. 清空
h.clearAll(storage);
assert.deepEqual(h.loadRecords(storage), []);

// 7. 导出结构有版本号
const json = JSON.parse(h.serialize([{ a: 1 }]));
assert.equal(json.schema, 'algo-agent.runs.v1');
assert.ok(Array.isArray(json.records));

// 8. 摘要能处理树的记录（没有比较/交换）
const line = h.describe({ algorithm: '中序遍历', size: 7, steps: 21, comparisons: null, swaps: null, ms: 2 });
assert.ok(line.includes('中序遍历') && line.includes('21 步'));
assert.ok(!line.includes('比较'), '树的记录不该出现比较次数');

// 9. 分组统计：次数、错误数、平均步数、平均比较
const groups = h.groupBy([
  { algorithm: '快速排序', steps: 10, ms: 2, comparisons: 4 },
  { algorithm: '快速排序', steps: 20, ms: 4, comparisons: 6 },
  { algorithm: '快速排序', steps: 0, ms: 1, comparisons: 0, error: '出错' },
  { algorithm: '中序遍历', steps: 21, ms: 3, comparisons: null }
]);
assert.equal(groups[0].algorithm, '快速排序', '次数最多的应排在前面');
assert.equal(groups[0].count, 3);
assert.equal(groups[0].errors, 1);
assert.equal(groups[0].avgSteps, 15, '平均步数只算成功的');
assert.equal(groups[0].avgComparisons, 5);
assert.equal(groups[1].avgComparisons, null, '树的记录平均比较应为 null');

// 10. 空记录不炸
assert.deepEqual(h.groupBy([]), []);

console.log('✅ 运行记录自测通过：10 项检查');