/**
 * 图的 BFS / DFS —— 执行器
 *
 * 一步的形状：
 *   { visited, current, frontier, treeEdges, note, metrics }
 * 其中 frontier 在 BFS 里是队列、在 DFS 里是栈，
 * treeEdges 是“搜索树”的边（谁发现谁），渲染器会把它们高亮出来。
 */
import { DEMO_GRAPH, adjacency } from './model.js';

function createState() {
  const steps = [];
  const state = {
    visited: [],
    current: null,
    frontier: [],
    treeEdges: [],
    metrics: { visited: 0, discovered: 0 }
  };

  const push = (note, extra = {}) => {
    steps.push({
      visited: state.visited.slice(),
      current: extra.current ?? state.current,
      frontier: state.frontier.slice(),
      treeEdges: state.treeEdges.map((edge) => edge.slice()),
      note,
      metrics: { ...state.metrics }
    });
  };

  return { steps, state, push };
}

export const bfs = {
  meta: {
    id: 'graph.bfs',
    name: '图的 BFS（广度优先）',
    kp: 'kp.5.1',
    brief: '按层扩展，用队列',
    view: 'graph',
    graph: DEMO_GRAPH
  },
  run(graph = DEMO_GRAPH) {
    const { steps, state, push } = createState();
    const adj = adjacency(graph);
    const seen = new Set();
    const queue = [];

    const start = graph.nodes[0];
    if (!start) {
      push('空图，没有可访问的节点');
      return steps;
    }

    seen.add(start.id);
    queue.push(start.id);
    state.frontier = queue;
    state.metrics.discovered += 1;
    push(`起点 ${start.label} 入队，标记为已发现`);

    while (queue.length > 0) {
      const id = queue.shift();
      state.frontier = queue;
      state.current = id;
      state.visited.push(id);
      state.metrics.visited += 1;

      // 取出即访问，此时才把已访问集合算进去
      push(`出队 ${id}，访问它（第 ${state.metrics.visited} 个）`);

      for (const next of adj.get(id) || []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
        state.frontier = queue;
        state.treeEdges.push([id, next]);
        state.metrics.discovered += 1;
        push(`发现邻居 ${next}，入队（队尾）`);
      }
    }

    // 图可能不连通：把剩下的连通分量也走一遍
    const rest = graph.nodes.map((node) => node.id).filter((id) => !seen.has(id));
    if (rest.length > 0) {
      push(`队列空了，但还有 ${rest.length} 个点没访问到 —— 图不连通，从 ${rest[0]} 重新开始`);
      seen.add(rest[0]);
      queue.push(rest[0]);
      state.frontier = queue;
      state.metrics.discovered += 1;
      push(`把 ${rest[0]} 入队，作为新的起点`);

      while (queue.length > 0) {
        const id = queue.shift();
        state.frontier = queue;
        state.current = id;
        state.visited.push(id);
        state.metrics.visited += 1;
        push(`出队 ${id}，访问它`);

        for (const next of adj.get(id) || []) {
          if (seen.has(next)) continue;
          seen.add(next);
          queue.push(next);
          state.frontier = queue;
          state.treeEdges.push([id, next]);
          state.metrics.discovered += 1;
          push(`发现邻居 ${next}，入队`);
        }
      }
    }

    state.current = null;
    push('队列空，BFS 结束');
    return steps;
  }
};

export const dfs = {
  meta: {
    id: 'graph.dfs',
    name: '图的 DFS（深度优先）',
    kp: 'kp.5.2',
    brief: '一条路走到黑，用栈',
    view: 'graph',
    graph: DEMO_GRAPH
  },
  run(graph = DEMO_GRAPH) {
    const { steps, state, push } = createState();
    const adj = adjacency(graph);
    const seen = new Set();
    const stack = [];

    const start = graph.nodes[0];
    if (!start) {
      push('空图，没有可访问的节点');
      return steps;
    }

    seen.add(start.id);
    stack.push(start.id);
    state.frontier = stack;
    state.metrics.discovered += 1;
    push(`起点 ${start.label} 入栈`);

    while (stack.length > 0) {
      const id = stack.pop();
      state.frontier = stack;
      state.current = id;
      state.visited.push(id);
      state.metrics.visited += 1;
      push(`弹出 ${id} 并访问它（第 ${state.metrics.visited} 个）`);

      // 逆序压栈，保证弹出时按字母顺序走，结果可复现
      const neighbors = (adj.get(id) || []).slice().reverse();
      for (const next of neighbors) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
        state.frontier = stack;
        state.treeEdges.push([id, next]);
        state.metrics.discovered += 1;
        push(`邻居 ${next} 还没访问，压栈（它会被优先处理）`);
      }
    }

    const rest = graph.nodes.map((node) => node.id).filter((id) => !seen.has(id));
    if (rest.length > 0) {
      push(`栈空了，但还有 ${rest.length} 个点没访问到 —— 图不连通，从 ${rest[0]} 重新开始`);
      seen.add(rest[0]);
      stack.push(rest[0]);
      state.frontier = stack;
      state.metrics.discovered += 1;
      push(`把 ${rest[0]} 入栈，作为新的起点`);

      while (stack.length > 0) {
        const id = stack.pop();
        state.frontier = stack;
        state.current = id;
        state.visited.push(id);
        state.metrics.visited += 1;
        push(`弹出 ${id} 并访问它`);

        const neighbors = (adj.get(id) || []).slice().reverse();
        for (const next of neighbors) {
          if (seen.has(next)) continue;
          seen.add(next);
          stack.push(next);
          state.frontier = stack;
          state.treeEdges.push([id, next]);
          state.metrics.discovered += 1;
          push(`邻居 ${next} 压栈`);
        }
      }
    }

    state.current = null;
    push('栈空，DFS 结束');
    return steps;
  }
};