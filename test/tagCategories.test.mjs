// 标签归并自测：细标签 → 大类
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const m = await import(pathToFileURL(path.resolve('src/knowledge/tagCategories.js')).href);

const cases = {
  并查集: '数据结构',
  树状数组: '数据结构',
  线段树: '数据结构',
  平衡树: '数据结构',
  '背包 DP': '动态规划',
  '动态规划 DP': '动态规划',
  '深度优先搜索 DFS': '搜索',
  BFS: '搜索',
  最短路: '图论',
  最小生成树: '图论',
  KMP: '字符串',
  'Trie 树': '字符串',
  模拟: '基础算法',
  贪心: '基础算法',
  二分: '基础算法',
  博弈论: '数学',
  凸包: '计算几何'
};

for (const [tag, expected] of Object.entries(cases)) {
  assert.equal(m.categoryOfTag(tag), expected, `${tag} 应归到 ${expected}`);
}

// 一个题多个标签 → 去重大类
assert.deepEqual(m.categoriesOfTags(['并查集', '线段树', '贪心']), ['数据结构', '基础算法']);
assert.deepEqual(m.categoriesOfTags(['并查集', 'LCT']), ['数据结构']);

// 空值不炸
assert.equal(m.categoryOfTag(''), '其他');
assert.deepEqual(m.categoriesOfTags([]), []);
assert.deepEqual(m.categoriesOfTags(null), []);

// 未知标签归入其他
assert.equal(m.categoryOfTag('某种没见过的标签'), '其他');

console.log('✅ 标签归并自测通过：18 个词 + 边界');