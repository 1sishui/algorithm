/**
 * 二叉树渲染器（SVG）
 *
 * 和数组柱状图一样，它只认「一步」这个数据结构：
 *   { visited, current, stack, note, metrics }
 * 它不知道什么是前序中序，只是把“谁访问过、谁正在访问、栈里有什么”画出来。
 *
 * 布局规则：x 由中序序号决定（保证不重叠），y 由深度决定。
 * 这样同一棵树永远长一个样，切换遍历方式时不会晃来晃去。
 */
const SVG_NS = 'http://www.w3.org/2000/svg';
const RADIUS = 22;
const X_GAP = 92;
const Y_GAP = 86;
const PAD = 46;

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}

export function createTreeView(container) {
  let svg = null;
  let nodeEls = new Map();
  let stackEl = null;
  let visitedEl = null;

  function buildTreeView(root) {
    container.innerHTML = '';
    nodeEls = new Map();
    if (!root) return;

    // 1. 算坐标：中序序号 → x，深度 → y
    const positions = new Map();
    let order = 0;
    let maxDepth = 0;

    const walk = (node, depth) => {
      if (!node) return;
      walk(node.left, depth + 1);
      positions.set(node.id, { x: PAD + order * X_GAP, y: PAD + depth * Y_GAP, node });
      order += 1;
      maxDepth = Math.max(maxDepth, depth);
      walk(node.right, depth + 1);
    };
    walk(root, 0);

    const width = PAD * 2 + Math.max(0, order - 1) * X_GAP;
    const height = PAD * 2 + maxDepth * Y_GAP;

    // 2. 画线（先画线，节点才能压在上面）
    svg = el('svg', {
      viewBox: `0 0 ${width} ${height}`,
      class: 'tree-svg',
      preserveAspectRatio: 'xMidYMid meet'
    });

    positions.forEach(({ x, y, node }) => {
      [node.left, node.right].forEach((child) => {
        if (!child) return;
        const p = positions.get(child.id);
        svg.appendChild(
          el('line', { x1: x, y1: y + RADIUS, x2: p.x, y2: p.y - RADIUS, class: 'tedge' })
        );
      });
    });

    // 3. 画节点
    positions.forEach(({ x, y, node }) => {
      const group = el('g', { class: 'tnode', 'data-id': node.id });
      group.appendChild(el('circle', { cx: x, cy: y, r: RADIUS }));
      const text = el('text', { x, y: y + 5, 'text-anchor': 'middle' });
      text.textContent = String(node.val);
      group.appendChild(text);
      svg.appendChild(group);
      nodeEls.set(node.id, group);
    });

    container.appendChild(svg);

    // 4. 栈与访问序列（文字辅助，解释“为什么是这个顺序”）
    const strip = document.createElement('div');
    strip.className = 'tree-strip';
    stackEl = document.createElement('span');
    stackEl.className = 'stack';
    visitedEl = document.createElement('span');
    visitedEl.className = 'visited';
    strip.appendChild(stackEl);
    strip.appendChild(visitedEl);
    container.appendChild(strip);
  }

  function label(root, ids) {
    return ids
      .map((id) => {
        const found = find(root, id);
        return found ? found.val : '?';
      })
      .join(' → ');
  }

  let treeRoot = null;

  function render(step) {
    if (!svg) return;

    nodeEls.forEach((group, id) => {
      group.classList.toggle('visited', step.visited.includes(id));
      group.classList.toggle('current', step.current === id);
      group.classList.toggle('instack', step.stack.includes(id));
    });

    if (stackEl) {
      stackEl.textContent = step.stack.length
        ? `栈（底 → 顶）：${label(treeRoot, step.stack)}`
        : '栈：空';
    }
    if (visitedEl) {
      visitedEl.textContent = step.visited.length
        ? `已访问：${label(treeRoot, step.visited)}`
        : '已访问：（还没开始）';
    }
  }

  function find(node, id) {
    if (!node) return null;
    if (node.id === id) return node;
    return find(node.left, id) || find(node.right, id);
  }

  return {
    view: 'tree',
    setTree(root) {
      treeRoot = root;
      buildTreeView(root);
    },
    render
  };
}