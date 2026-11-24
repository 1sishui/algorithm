/**
 * 二叉树模型：把「层序数组」变成节点对象。
 *
 * 用层序数组是因为它最好写也最好读：
 *   [4, 2, 6, 1, 3, 5, 7]
 *        4
 *      /   \
 *     2     6
 *    / \   / \
 *   1   3 5   7
 * 下标 i 的左孩子在 2i+1，右孩子在 2i+2；null 表示空位。
 */
export function buildTree(values) {
  if (!values || values.length === 0 || values[0] == null) return null;

  const nodes = values.map((value, index) =>
    value == null ? null : { id: `n${index}`, val: value, left: null, right: null }
  );

  for (let i = 0; i < nodes.length; i++) {
    if (!nodes[i]) continue;
    const leftIndex = i * 2 + 1;
    const rightIndex = i * 2 + 2;
    if (leftIndex < nodes.length) nodes[i].left = nodes[leftIndex];
    if (rightIndex < nodes.length) nodes[i].right = nodes[rightIndex];
  }

  return nodes[0];
}

/** 遍历所有节点，返回数组（渲染器要用它算坐标） */
export function flatten(root) {
  const result = [];
  const walk = (node) => {
    if (!node) return;
    result.push(node);
    walk(node.left);
    walk(node.right);
  };
  walk(root);
  return result;
}