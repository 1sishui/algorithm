/** 冒泡排序 —— 执行器（结构同 quick.js，可直接对照阅读） */
export const meta = {
  id: 'sort.bubble',
  name: '冒泡排序',
  kp: 'kp.1.0',
  brief: '相邻两两比较，大的往后冒'
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
      pivot: -1,
      compare: extra.compare ?? [],
      swap: extra.swap ?? [],
      depth: 0,
      note,
      metrics: { ...metrics }
    });
  };

  push('初始数组');

  for (let end = a.length - 1; end > 0; end--) {
    let swapped = false;
    for (let i = 0; i < end; i++) {
      metrics.comparisons++;
      push(`比较 a[${i}] = ${a[i]} 与 a[${i + 1}] = ${a[i + 1]}`, { compare: [i, i + 1] });
      if (a[i] > a[i + 1]) {
        [a[i], a[i + 1]] = [a[i + 1], a[i]];
        metrics.swaps++;
        swapped = true;
        push('左边比右边大，交换', { swap: [i, i + 1] });
      }
    }
    sorted[end] = true;
    push(`第 ${a.length - end} 轮结束，a[${end}] = ${a[end]} 已归位`);

    if (!swapped) {
      for (let k = 0; k < a.length; k++) sorted[k] = true;
      push('这一轮没有发生交换，说明已经有序，提前结束');
      break;
    }
  }

  sorted.fill(true);
  push('排序完成');
  return steps;
}