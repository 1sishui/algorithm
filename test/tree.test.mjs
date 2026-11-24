// 二叉树遍历自测：不开浏览器，验证访问顺序与步骤完整性
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve('src/algorithms/tree');
const load = async (name) => import(pathToFileURL(path.join(root, name)).href);

const { preorder, inorder, postorder } = await load('traversal.js');
const { buildTree } = await load('model.js');

const EXPECT = {
  'tree.preorder': [4, 2, 1, 3, 6, 5, 7],
  'tree.inorder': [1, 2, 3, 4, 5, 6, 7],
  'tree.postorder': [1, 3, 2, 5, 7, 6, 4]
};

for (const algo of [preorder, inorder, postorder]) {
  const steps = algo.run();
  assert.ok(steps.length > 0, `${algo.meta.id} 没有产出步骤`);

  const last = steps[steps.length - 1];
  assert.deepEqual(last.visited.length, 7, `${algo.meta.id} 访问节点数不对`);

  const order = last.visited.map((id) => Number(id.slice(1))).map((i) => [4, 2, 6, 1, 3, 5, 7][i]);
  assert.deepEqual(order, EXPECT[algo.meta.id], `${algo.meta.id} 访问顺序不对：${order}`);

  // 每一步都要有解释，且 current 必须在合法范围内
  for (const step of steps) {
    assert.ok(typeof step.note === 'string' && step.note.length > 0, '存在没有说明的步骤');
    assert.ok(Array.isArray(step.visited) && Array.isArray(step.stack), '步骤结构不完整');
    if (step.current !== null) {
      assert.ok(/^n\d+$/.test(step.current), `current 非法：${step.current}`);
    }
  }

  // 步骤里的 visited 必须是递增的历史快照，不能共用同一个数组
  if (steps.length > 2) {
    assert.notEqual(steps[1].visited, steps[2].visited, 'visited 快照共用了同一个数组');
  }
}

// 层序建树：下标 i 的左孩子在 2i+1、右孩子在 2i+2
const t = buildTree([1, 2, 3]);
assert.equal(t.val, 1);
assert.equal(t.left.val, 2);
assert.equal(t.right.val, 3);
assert.equal(t.left.left, null);

// null 表示空位；空位的子树不可达
const t2 = buildTree([1, null, 2, null, null, 3]);
assert.equal(t2.left, null);
assert.equal(t2.right.left.val, 3);

console.log('✅ 二叉树遍历自测通过：前序/中序/后序顺序正确，步骤结构完整');