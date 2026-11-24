/**
 * 图渲染器（SVG，椭圆布局）
 *
 * 只认一步的数据：谁访问过、谁正在访问、待访问队列/栈里有什么、哪些是搜索树的边。
 * 布局用椭圆排一圈，保证任意 20 个点以内都不会重叠。
 */
const SVG_NS = 'http://www.w3.org/2000/svg';
const R = 21;
const W = 820;
const H = 330;

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}

function edgeKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function createGraphView(container) {
  let svg = null;
  let nodeEls = new Map();
  let edgeEls = new Map();
  let frontierEl = null;
  let visitedEl = null;
  let labels = new Map();

  function setGraph(graph) {
    container.innerHTML = '';
    nodeEls = new Map();
    edgeEls = new Map();
    labels = new Map(graph.nodes.map((node) => [node.id, node.label || node.id]));
    if (!graph.nodes.length) return;

    const cx = W / 2;
    const cy = H / 2;
    const rx = W / 2 - 70;
    const ry = H / 2 - 60;

    const pos = new Map();
    graph.nodes.forEach((node, index) => {
      const angle = -Math.PI / 2 + (index * 2 * Math.PI) / graph.nodes.length;
      pos.set(node.id, { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
    });

    svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'graph-svg', preserveAspectRatio: 'xMidYMid meet' });

    for (const [a, b] of graph.edges) {
      const pa = pos.get(a);
      const pb = pos.get(b);
      if (!pa || !pb) continue;
      const line = el('line', { x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y, class: 'gedge' });
      svg.appendChild(line);
      edgeEls.set(edgeKey(a, b), line);
    }

    graph.nodes.forEach((node) => {
      const p = pos.get(node.id);
      const group = el('g', { class: 'gnode', 'data-id': node.id });
      group.appendChild(el('circle', { cx: p.x, cy: p.y, r: R }));
      const text = el('text', { x: p.x, y: p.y + 5, 'text-anchor': 'middle' });
      text.textContent = String(node.label || node.id);
      group.appendChild(text);
      svg.appendChild(group);
      nodeEls.set(node.id, group);
    });

    container.appendChild(svg);

    const strip = document.createElement('div');
    strip.className = 'tree-strip';
    frontierEl = document.createElement('span');
    frontierEl.className = 'stack';
    visitedEl = document.createElement('span');
    visitedEl.className = 'visited';
    strip.appendChild(frontierEl);
    strip.appendChild(visitedEl);
    container.appendChild(strip);
  }

  function nameOf(id) {
    return labels.get(id) || id;
  }

  function render(step) {
    if (!svg) return;

    nodeEls.forEach((group, id) => {
      group.classList.toggle('visited', step.visited.includes(id));
      group.classList.toggle('current', step.current === id);
      group.classList.toggle('frontier', step.frontier.includes(id) && !step.visited.includes(id));
    });

    const treeKeys = new Set((step.treeEdges || []).map(([a, b]) => edgeKey(a, b)));
    edgeEls.forEach((line, key) => {
      line.classList.toggle('tree', treeKeys.has(key));
    });

    if (frontierEl) {
      frontierEl.textContent = step.frontier.length
        ? `待访问（${step.frontier.length}）：${step.frontier.map(nameOf).join(' → ')}`
        : '待访问：空';
    }
    if (visitedEl) {
      visitedEl.textContent = step.visited.length
        ? `已访问：${step.visited.map(nameOf).join(' → ')}`
        : '已访问：（还没开始）';
    }
  }

  return { view: 'graph', setGraph, render };
}