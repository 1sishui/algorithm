// 图 BFS/DFS 自测：访问顺序、搜索树边数、解析器边界
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const base = path.resolve('src/algorithms/graph');
const load = async (name) => import(pathToFileURL(path.join(base, name)).href);

const { bfs, dfs } = await load('traversal.js');
const { DEMO_GRAPH, parseEdgeList, adjacency } = await load('model.js');

// 1. 邻接表是对称的
const adj = adjacency(DEMO_GRAPH);
assert.deepEqual(adj.get('A'), ['B', 'C']);
assert.deepEqual(adj.get('D'), ['B', 'C', 'E']);

// 2. BFS 顺序（按字母序扩展）
const bfsSteps = bfs.run(DEMO_GRAPH);
const bfsOrder = bfsSteps[bfsSteps.length - 1].visited;
assert.deepEqual(bfsOrder, ['A', 'B', 'C', 'D', 'F', 'E'], `BFS 顺序不对：${bfsOrder}`);

// 3. DFS 顺序
const dfsSteps = dfs.run(DEMO_GRAPH);
const dfsOrder = dfsSteps[dfsSteps.length - 1].visited;
assert.deepEqual(dfsOrder, ['A', 'B', 'D', 'E', 'F', 'C'], `DFS 顺序不对：${dfsOrder}`);

// 4. 搜索树边数 = 点数 - 1（连通图）
assert.equal(bfsSteps[bfsSteps.length - 1].treeEdges.length, DEMO_GRAPH.nodes.length - 1);
assert.equal(dfsSteps[dfsSteps.length - 1].treeEdges.length, DEMO_GRAPH.nodes.length - 1);

// 5. 每一步都有说明，且快照独立
for (const step of bfsSteps) {
  assert.ok(step.note && step.note.length > 0, '有步骤没写说明');
  assert.ok(Array.isArray(step.frontier), 'frontier 结构不对');
}
assert.notEqual(bfsSteps[1].visited, bfsSteps[2].visited, 'visited 共用了同一个数组');

// 6. 断开的图：会提示不连通，并把所有点走完
const split = {
  nodes: ['A', 'B', 'C', 'D'].map((id) => ({ id, label: id })),
  edges: [['A', 'B'], ['C', 'D']]
};
const splitSteps = bfs.run(split);
const splitLast = splitSteps[splitSteps.length - 1];
assert.equal(splitLast.visited.length, 4, '断开的图应该把所有点都访问到');
assert.ok(splitSteps.some((s) => /不连通/.test(s.note)), '应该提示图不连通');

// 7. 解析边列表
const parsed = parseEdgeList('A-B, A-C; B-D');
assert.equal(parsed.edges.length, 3);
assert.deepEqual(parsed.nodes.map((n) => n.id), ['A', 'B', 'C', 'D']);

// 8. 非法输入返回 null
assert.equal(parseEdgeList('随便写点什么'), null);
assert.equal(parseEdgeList('A-A'), null);

// 9. 超过 20 个点返回 null
const many = Array.from({ length: 30 }, (_, i) => `n${i}-n${i + 1}`).join(', ');
assert.equal(parseEdgeList(many), null);

// 10. 空图不崩
const empty = bfs.run({ nodes: [], edges: [] });
assert.equal(empty.length, 1);
assert.match(empty[0].note, /空图/);

console.log('✅ 图遍历自测通过：BFS/DFS 顺序、搜索树、不连通、解析边界');