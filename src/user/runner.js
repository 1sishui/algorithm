/**
 * 「我自己的代码」执行器
 *
 * 核心设计：任何语言都无法“自动”知道算法执行到哪一步，
 * 必须由代码主动报告状态 —— 所以给使用者一个 viz 对象，在关键位置调用它。
 *
 * 使用者写：
 *   function run(a, viz) {
 *     viz.compare(i, j, '比较两个元素');
 *     viz.swap(i, j, '交换');
 *   }
 *
 * 我们把它跑起来，收集每一步的数组快照，交给现有的柱状图渲染器播放。
 * 这样“加一个自己的算法”不需要改任何界面代码。
 */
export const MAX_STEPS = 3000;

export const TEMPLATE = [
  '// 在这里写你的算法：a 是数组（可以直接改），viz 用来记录每一步',
  'function run(a, viz) {',
  '  for (let i = 0; i < a.length - 1; i++) {',
  '    for (let j = 0; j < a.length - 1 - i; j++) {',
  '      viz.compare(j, j + 1, `比较 a[${j}]=${a[j]} 与 a[${j + 1}]=${a[j + 1]}`);',
  '      if (a[j] > a[j + 1]) {',
  '        viz.swap(j, j + 1, `逆序，交换 a[${j}] 和 a[${j + 1}]`);',
  '      }',
  '    }',
  '    viz.markSorted(a.length - 1 - i, `第 ${i + 1} 轮结束，a[${a.length - 1 - i}] 就位`);',
  '  }',
  "  viz.done('排序完成');",
  '}'
].join('\n');

const API_HINT = [
  'viz.compare(i, j, 说明)  比较两个位置',
  'viz.swap(i, j, 说明)     交换两个位置',
  'viz.set(i, 值, 说明)     给某个位置赋值',
  'viz.markSorted(i, 说明)  标记某位置已就位',
  'viz.show(说明, {compare:[i], swap:[j], pivot:i})  自定义一步',
  'viz.done(说明)           结束'
].join('\n');

export function runUserCode(source, input) {
  const a = Array.isArray(input) ? input.slice() : [];
  const steps = [];
  const sorted = new Array(a.length).fill(false);
  const metrics = { comparisons: 0, swaps: 0 };

  const snapshot = (note, opts = {}) => {
    if (steps.length >= MAX_STEPS) {
      throw new Error(`步骤超过 ${MAX_STEPS} 步，可能是死循环。检查一下循环的终止条件。`);
    }
    steps.push({
      array: a.slice(),
      sorted: sorted.slice(),
      pivot: opts.pivot ?? -1,
      compare: opts.compare ?? [],
      swap: opts.swap ?? [],
      depth: opts.depth ?? 0,
      note: String(note ?? ''),
      metrics: { ...metrics }
    });
  };

  const viz = {
    show(note, opts) {
      snapshot(note, opts);
    },
    compare(i, j, note) {
      metrics.comparisons += 1;
      snapshot(note ?? `比较 a[${i}] 和 a[${j}]`, { compare: [i, j] });
    },
    swap(i, j, note) {
      [a[i], a[j]] = [a[j], a[i]];
      metrics.swaps += 1;
      snapshot(note ?? `交换 a[${i}] 和 a[${j}]`, { swap: [i, j] });
    },
    set(i, value, note) {
      a[i] = value;
      snapshot(note ?? `a[${i}] = ${value}`);
    },
    markSorted(i, note) {
      sorted[i] = true;
      snapshot(note ?? `a[${i}] 已就位`);
    },
    done(note) {
      sorted.fill(true);
      snapshot(note ?? '完成');
    }
  };

  let run;
  try {
    // 用户代码只在这个函数作用域里跑，拿不到页面的其他变量
    const factory = new Function('viz', `"use strict";\n${source}\n;return typeof run === "function" ? run : null;`);
    run = factory(viz);
  } catch (error) {
    return { ok: false, error: `代码有语法错误：${error.message}`, hint: API_HINT };
  }

  if (typeof run !== 'function') {
    return {
      ok: false,
      error: '没有找到 run 函数。算法要写进 function run(a, viz) { ... } 里面。',
      hint: API_HINT
    };
  }

  try {
    run(a, viz);
  } catch (error) {
    return {
      ok: false,
      error: `运行出错：${error.message}`,
      steps,
      hint: steps.length ? '下面是你已经跑出来的部分，可以先播放看看。' : API_HINT
    };
  }

  if (steps.length === 0) {
    return {
      ok: false,
      error: '一步都没记录。请在关键位置调用 viz.compare / viz.swap / viz.show。',
      hint: API_HINT
    };
  }

  return { ok: true, steps };
}