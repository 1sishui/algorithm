/**
 * 算法注册表
 *
 * 新增一个算法 = 建一个文件（导出 meta 和 run）+ 在这里登记一行。
 * 界面、播放器、渲染器都不需要改，这是这套架构的意义。
 *
 * meta.view 决定用哪个渲染器：'array' 用柱状图，'tree' 用 SVG 树。
 */
import * as quick from './sort/quick.js';
import * as bubble from './sort/bubble.js';
import * as insertion from './sort/insertion.js';
import { preorder, inorder, postorder } from './tree/traversal.js';
import { bfs, dfs } from './graph/traversal.js';

const sorts = [quick, bubble, insertion].map((mod) => ({
  ...mod.meta,
  view: 'array',
  run: mod.run
}));

const traversals = [preorder, inorder, postorder].map((mod) => ({
  ...mod.meta,
  run: mod.run
}));

const graphs = [bfs, dfs].map((mod) => ({
  ...mod.meta,
  run: mod.run
}));

export const algorithms = [...sorts, ...traversals, ...graphs];

export function findAlgorithm(id) {
  return algorithms.find((algo) => algo.id === id) || algorithms[0];
}

export function findByKnowledgePoint(kpId) {
  return algorithms.find((algo) => algo.kp === kpId) || null;
}