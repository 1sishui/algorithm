/** 插入排序 —— 执行器 */
export const meta = {
  id: 'sort.insertion',
  name: '插入排序',
  kp: 'kp.1.1',
  brief: '把当前元素插到前面已排好的序列里'
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
      depth: 0,
      note,
      metrics: { ...metrics }
    });
  };

  if (a.length > 0) sorted[0] = true;
  push('第一个元素自己就算有序');

  for (let i = 1; i < a.length; i++) {
    const key = a[i];
    push(`取出 a[${i}] = ${key}，准备插到前面合适的位置`, { pivot: i });

    let j = i - 1;
    while (j >= 0) {
      metrics.comparisons++;
      push(`比较 a[${j}] = ${a[j]} 与 ${key}`, { pivot: i, compare: [j] });
      if (a[j] <= key) break;
      a[j + 1] = a[j];
      metrics.swaps++;
      push(`${a[j]} 比 ${key} 大，右移一格`, { pivot: i, swap: [j, j + 1] });
      j--;
    }

    a[j + 1] = key;
    for (let k = 0; k <= i; k++) sorted[k] = true;
    push(`把 ${key} 放到下标 ${j + 1}，前 ${i + 1} 个元素已有序`, { pivot: j + 1 });
  }

  sorted.fill(true);
  push('排序完成');
  return steps;
}