/**
 * 算法注册表
 *
 * 新增一个算法 = 建一个文件（导出 meta 和 run）+ 在这里登记一行。
 * UI、播放器、渲染器都不需要改，这是这套架构的意义。
 */
import * as quick from './sort/quick.js';
import * as bubble from './sort/bubble.js';
import * as insertion from './sort/insertion.js';

export const algorithms = [quick, bubble, insertion].map((mod) => ({
  ...mod.meta,
  run: mod.run
}));

export function findAlgorithm(id) {
  return algorithms.find((algo) => algo.id === id) || algorithms[0];
}

export function findByKnowledgePoint(kpId) {
  return algorithms.find((algo) => algo.kp === kpId) || null;
}