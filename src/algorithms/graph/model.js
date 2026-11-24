/**
 * 图模型
 *
 * 图只存“有哪些点、哪些边”，不存坐标 —— 坐标是渲染器的事。
 * 这样同一张图可以换布局（圆形、力导向），模型不用动。
 */

/** 默认演示图：6 个点、7 条边，有环，适合演示 BFS/DFS 的差别 */
export const DEMO_GRAPH = {
  nodes: ['A', 'B', 'C', 'D', 'E', 'F'].map((id) => ({ id, label: id })),
  edges: [
    ['A', 'B'],
    ['A', 'C'],
    ['B', 'D'],
    ['C', 'D'],
    ['D', 'E'],
    ['E', 'F'],
    ['C', 'F']
  ]
};

/** 邻接表；无向图，两边都加。顺序排序保证每次跑出来的结果一样 */
export function adjacency(graph) {
  const map = new Map(graph.nodes.map((node) => [node.id, []]));
  for (const [u, v] of graph.edges) {
    if (!map.has(u) || !map.has(v)) continue;
    map.get(u).push(v);
    map.get(v).push(u);
  }
  for (const list of map.values()) list.sort();
  return map;
}

/**
 * 把 "A-B, A-C; B-D" 解析成图。
 * 支持 -, —, →, -> 四种连接符；点数上限 20。
 */
export function parseEdgeList(text) {
  const items = String(text)
    .split(/[;；,，\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const seen = new Set();
  const nodes = [];
  const edges = [];

  for (const item of items) {
    const match = item.match(/^([A-Za-z0-9_]+)\s*(?:-|—|→|->)\s*([A-Za-z0-9_]+)$/);
    if (!match) continue;

    const [, a, b] = match;
    if (a === b) continue;

    for (const id of [a, b]) {
      if (!seen.has(id)) {
        seen.add(id);
        nodes.push({ id, label: id });
      }
    }
    edges.push([a, b]);
    if (nodes.length > 20) return null;
  }

  if (edges.length === 0) return null;
  return { nodes, edges };
}