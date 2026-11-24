/**
 * 知识图谱（v0：12 大类、45 个知识点）
 *
 * 目标版本是 12 大类、80 余个知识点（见申请书），
 * 这里先把结构和交互跑通，剩下的节点按同样格式往里加即可。
 *
 * 节点 id 规则：kp.<大类下标>.<节点下标>，算法通过 meta.kp 与节点绑定。
 */

const RAW = [
  ['基础数据结构', ['数组', '链表', '栈', '队列', '哈希表', '堆']],
  ['排序', ['冒泡排序', '插入排序', '快速排序', '归并排序', '堆排序']],
  ['查找', ['二分查找', '哈希查找']],
  ['递归与分治', ['递归', '分治', '回溯']],
  ['树', ['二叉树遍历', '二叉搜索树', '平衡树', '线段树']],
  ['图', ['图的存储', 'BFS', 'DFS', '拓扑排序', '最短路', '最小生成树']],
  ['动态规划', ['线性 DP', '区间 DP', '背包问题', '状态压缩 DP']],
  ['字符串', ['KMP', 'Trie 树', '字符串哈希']],
  ['贪心', ['区间贪心', '排序贪心']],
  ['数学', ['数论基础', '快速幂', '组合数学']],
  ['计算几何', ['凸包', '扫描线']],
  ['复杂度与技巧', ['时间复杂度分析', '双指针', '前缀和', '差分']]
];

/** 前置依赖：key 依赖 value 中的节点 */
const PREREQ = {
  'kp.1.2': ['kp.3.0'], // 快速排序 依赖 递归
  'kp.1.3': ['kp.3.1'], // 归并排序 依赖 分治
  'kp.2.0': ['kp.0.0'], // 二分查找 依赖 数组
  'kp.4.1': ['kp.4.0'], // 二叉搜索树 依赖 二叉树遍历
  'kp.5.3': ['kp.5.2'], // 拓扑排序 依赖 DFS
  'kp.5.4': ['kp.0.5'], // 最短路 依赖 堆
  'kp.6.2': ['kp.6.0'], // 背包 依赖 线性 DP
  'kp.7.0': ['kp.7.2'], // KMP 依赖 字符串哈希
  'kp.8.0': ['kp.1.0']  // 区间贪心 依赖 排序
};

export const categories = RAW.map(([name, nodes], ci) => ({
  id: `cat.${ci}`,
  name,
  nodes: nodes.map((nodeName, ni) => {
    const id = `kp.${ci}.${ni}`;
    return {
      id,
      name: nodeName,
      category: name,
      prereq: PREREQ[id] || [],
      // 演示用掌握度：由 id 派生的稳定伪随机值（真实版本来自评估模型）
      mastery: demoMastery(id)
    };
  })
}));

export const allNodes = categories.flatMap((cat) => cat.nodes);

export const nodeById = new Map(allNodes.map((node) => [node.id, node]));

function demoMastery(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 1000;
  return 35 + (h % 55); // 35 ~ 89
}

/** 推荐下一知识点：掌握度最低、且前置已掌握 */
export function recommend(nodes = allNodes) {
  const ready = nodes.filter(
    (node) => node.prereq.every((pre) => (nodeById.get(pre)?.mastery ?? 100) >= 60)
  );
  const pool = ready.length > 0 ? ready : nodes;
  const target = pool.reduce((a, b) => (a.mastery <= b.mastery ? a : b));

  const missing = target.prereq.filter((pre) => (nodeById.get(pre)?.mastery ?? 100) < 60);
  const why =
    missing.length > 0
      ? `前置知识点「${missing.map((id) => nodeById.get(id)?.name).join('、')}」还没掌握，建议先补。`
      : `掌握度 ${target.mastery}，是当前最薄弱的环节。`;

  return { node: target, why };
}