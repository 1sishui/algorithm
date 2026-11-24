// 「我自己的代码」执行器自测：不开浏览器，验证步骤收集与错误处理
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const mod = await import(pathToFileURL(path.resolve('src/user/runner.js')).href);
const { runUserCode, TEMPLATE, MAX_STEPS } = mod;

// 1. 模板代码能跑通，且结果有序
const input = [5, 2, 9, 1, 7];
const good = runUserCode(TEMPLATE, input);
assert.equal(good.ok, true, '模板代码运行失败：' + (good.error || ''));
assert.ok(good.steps.length > 5, '步骤太少');
const last = good.steps[good.steps.length - 1];
assert.deepEqual(last.array, [...input].sort((a, b) => a - b), '模板排序结果不对');
assert.deepEqual(input, [5, 2, 9, 1, 7], '入参被修改');
assert.ok(last.metrics.comparisons > 0, '比较次数没统计');

// 2. 步骤里的数组必须是独立快照
assert.notEqual(good.steps[0].array, good.steps[1].array, '快照共用了同一个数组');

// 3. 作者忘了写 run 函数 → 明确报错
const noRun = runUserCode('function mysort(a){ return a; }', [3, 1]);
assert.equal(noRun.ok, false);
assert.match(noRun.error, /run/);

// 4. 语法错误 → 明确报错
const broken = runUserCode('function run(a, viz) { if ( }', [1, 2]);
assert.equal(broken.ok, false);
assert.match(broken.error, /语法错误/);

// 5. 死循环 → 到步数上限停下，不卡死整个页面
const loop = runUserCode('function run(a, viz) { while (true) { viz.show("转圈"); } }', [1, 2]);
assert.equal(loop.ok, false);
assert.match(loop.error, /死循环|步/);

// 6. 一步都不记录 → 提示怎么用
const silent = runUserCode('function run(a, viz) { a[0] = 1; }', [3, 2]);
assert.equal(silent.ok, false);
assert.match(silent.error, /viz/);

// 7. viz.set / markSorted 生效
const setter = runUserCode(
  'function run(a, viz) { viz.set(0, 42, "改第一个"); viz.markSorted(0); viz.done(); }',
  [1, 2]
);
assert.equal(setter.ok, true);
assert.equal(setter.steps[0].array[0], 42);
assert.equal(setter.steps[1].sorted[0], true);

// 8. 上限常量合理
assert.ok(MAX_STEPS >= 500 && MAX_STEPS <= 10000);

console.log('✅ 自定义代码执行器自测通过：8 项检查');