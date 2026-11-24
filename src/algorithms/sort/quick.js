/**
 * 快速排序 —— 执行器
 *
 * 约定（整个项目所有算法都必须遵守）：
 *   run(input) 是纯函数：不改动 input，不碰 DOM，不读时间/随机数。
 *   返回值是「每一步的快照数组」，渲染器只认这个数组。
 *
 * 一步的形状见 src/core/types.js
 */
export const meta = {
  id: 'sort.quick',
  name: '快速排序',
  kp: 'kp.1.2', // 对应知识图谱里的「快速排序」
  brief: '选基准 → 划分 → 递归左右两段'
};

export function run(input) {
  const a = input.slice();
  const steps = [];
  const sorted = new Array(a.length).fill(false);
  const metrics = { comparisons: 0, swaps: 0 };

  const push = (note, extra = {}) => {
    steps.push({
      array: a.slice(),
      sorted: sorted.slice(),
      pivot: extra.pivot ?? -1,
      compare: extra.compare ?? [],
      swap: extra.swap ?? [],
      depth: extra.depth ?? 0,
      note,
      metrics: { ...metrics }
    });
  };

  if (a.length === 0) {
    push('输入为空，没有可排序的元素');
    return steps;
  }

  push('初始数组，准备以每段最后一个元素为基准做划分');

  const sortRange = (lo, hi, depth) => {
    if (lo > hi) return;
    if (lo === hi) {
      sorted[lo] = true;
      push(`区间 [${lo}, ${lo}] 只剩一个元素，位置已确定`, { depth });
      return;
    }

    const pivotValue = a[hi];
    push(`区间 [${lo}, ${hi}]，取 a[${hi}] = ${pivotValue} 作为基准`, { pivot: hi, depth });

    let store = lo;
    for (let i = lo; i < hi; i++) {
      metrics.comparisons++;
      push(`比较 a[${i}] = ${a[i]} 与基准 ${pivotValue}`, { pivot: hi, compare: [i], depth });
      if (a[i] < pivotValue) {
        if (i !== store) {
          [a[i], a[store]] = [a[store], a[i]];
          metrics.swaps++;
          push(`a[${i}] 更小，与 a[${store}] 交换，指针后移`, { swap: [i, store], depth });
        }
        store++;
      }
    }

    if (store !== hi) {
      [a[store], a[hi]] = [a[hi], a[store]];
      metrics.swaps++;
    }
    sorted[store] = true;
    push(`基准 ${pivotValue} 归位到下标 ${store}：左边都比它小，右边都比它大`, { pivot: store, depth });

    sortRange(lo, store - 1, depth + 1);
    sortRange(store + 1, hi, depth + 1);
  };

  sortRange(0, a.length - 1, 0);

  sorted.fill(true);
  push('排序完成', { depth: 0 });
  return steps;
}