/**
 * 二叉树遍历 —— 执行器
 *
 * 和排序算法一样：纯函数，产出「每一步的状态」，不碰 DOM。
 * 不同的是状态形状：这里记录「当前节点 / 已访问 / 栈里有什么」，
 * 因为树的可视化要画的是“访问顺序”和“栈的进出”，不是数组。

 * 一步的形状：
 * { visited: [节点id], current: 节点id|null, stack: [节点id], note, metrics }
 */
import { buildTree } from './model.js';

const DEMO_TREE = buildTree([4, 2, 6, 1, 3, 5, 7]);

function makeSteps() {
  const steps = [];
  const state = {
    visited: [],
    current: null,
    stack: [],
    metrics: { visited: 0, pushed: 0 }
  };

  const push = (note, extra = {}) => {
    steps.push({
      visited: state.visited.slice(),
      current: extra.current ?? state.current,
      stack: state.stack.slice(),
      note,
      metrics: { ...state.metrics }
    });
  };

  return { steps, state, push };
}

/** 前序：根 → 左 → 右（用栈，先压右再压左） */
export const preorder = {
  meta: {
    id: 'tree.preorder',
    name: '二叉树前序遍历',
    kp: 'kp.4.0',
    brief: '根 → 左 → 右',
    view: 'tree',
    tree: DEMO_TREE
  },
  run() {
    const { steps, state, push } = makeSteps();
    const root = DEMO_TREE;
    if (!root) {
      push('空树，没有可访问的节点');
      return steps;
    }

    state.stack.push(root.id);
    state.metrics.pushed++;
    push(`把根节点 ${root.val} 压栈`);

    while (state.stack.length > 0) {
      const id = state.stack.pop();
      const node = findById(root, id);
      state.visited.push(node.id);
      state.current = node.id;
      state.metrics.visited++;
      push(`弹出 ${node.val} 并访问它`);

      if (node.right) {
        state.stack.push(node.right.id);
        state.metrics.pushed++;
        push(`${node.val} 的右孩子 ${node.right.val} 后访问，先压栈`);
      }
      if (node.left) {
        state.stack.push(node.left.id);
        state.metrics.pushed++;
        push(`${node.val} 的左孩子 ${node.left.val} 先访问，后压栈（在栈顶）`);
      }
    }

    state.current = null;
    push('栈空，前序遍历结束');
    return steps;
  }
};

/** 中序：左 → 根 → 右（一路向左压栈，弹出来就访问） */
export const inorder = {
  meta: {
    id: 'tree.inorder',
    name: '二叉树中序遍历',
    kp: 'kp.4.0',
    brief: '左 → 根 → 右',
    view: 'tree',
    tree: DEMO_TREE
  },
  run() {
    const { steps, state, push } = makeSteps();
    const root = DEMO_TREE;
    if (!root) {
      push('空树，没有可访问的节点');
      return steps;
    }

    let current = root;
    push('从中序遍历的起点：根节点开始');

    while (current || state.stack.length > 0) {
      while (current) {
        state.stack.push(current.id);
        state.metrics.pushed++;
        push(`把 ${current.val} 压栈，继续往左走`);
        current = current.left;
      }

      const id = state.stack.pop();
      const node = findById(root, id);
      state.visited.push(node.id);
      state.current = node.id;
      state.metrics.visited++;
      push(`左边走到底了，弹出 ${node.val} 并访问`);

      current = node.right;
      if (current) {
        push(`转向 ${node.val} 的右子树 ${current.val}`);
      }
    }

    state.current = null;
    push('栈空且没有右子树可走，中序遍历结束');
    return steps;
  }
};

/** 后序：左 → 右 → 根（回到节点时还要判断右子树是否访问完） */
export const postorder = {
  meta: {
    id: 'tree.postorder',
    name: '二叉树后序遍历',
    kp: 'kp.4.0',
    brief: '左 → 右 → 根',
    view: 'tree',
    tree: DEMO_TREE
  },
  run() {
    const { steps, state, push } = makeSteps();
    const root = DEMO_TREE;
    if (!root) {
      push('空树，没有可访问的节点');
      return steps;
    }

    let lastVisited = null;
    state.stack.push(root.id);
    state.metrics.pushed++;
    push('把根节点压栈');

    while (state.stack.length > 0) {
      const topId = state.stack[state.stack.length - 1];
      const node = findById(root, topId);

      if (node.left && lastVisited !== node.left.id && lastVisited !== node.right?.id) {
        state.stack.push(node.left.id);
        state.metrics.pushed++;
        push(`${node.val} 的左子树还没走，先去 ${node.left.val}`);
        continue;
      }

      if (node.right && lastVisited !== node.right.id) {
        state.stack.push(node.right.id);
        state.metrics.pushed++;
        push(`${node.val} 的左子树走完了，转到右子树 ${node.right.val}`);
        continue;
      }

      state.stack.pop();
      state.visited.push(node.id);
      state.current = node.id;
      state.metrics.visited++;
      lastVisited = node.id;
      push(`${node.val} 的左右都访问完了，最后访问它`);
    }

    state.current = null;
    push('栈空，后序遍历结束');
    return steps;
  }
};

function findById(root, id) {
  if (!root) return null;
  if (root.id === id) return root;
  return findById(root.left, id) || findById(root.right, id);
}