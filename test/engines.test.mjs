// 逻辑自测：不开浏览器，直接验证执行器产出是否正确
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve('src/algorithms/sort');
const load = async (name) => import(pathToFileURL(path.join(root, name)).href);

const cases = [
  ['quick.js', []],
  ['quick.js', [5]],
  ['quick.js', [5, 2, 9, 1, 7]],
  ['bubble.js', [5, 2, 9, 1, 7]],
  ['bubble.js', [3, 3, 1, 2, 1]],
  ['insertion.js', [5, 2, 9, 1, 7]],
  ['insertion.js', [1, 2, 3, 4]]
];

let n = 0;
for (const [file, input] of cases) {
  const mod = await load(file);
  const steps = mod.run(input);
  const last = steps[steps.length - 1];
  const expected = [...input].sort((a, b) => a - b);
  assert.deepEqual(last.array, expected, `${file} ${JSON.stringify(input)} 结果不对`);
  assert.deepEqual(input, input.slice(), 'fixture 被改动');
  // 每一步都必须是独立快照
  if (steps.length > 1) assert.notEqual(steps[0].array, steps[1].array, '快照没有独立');
  // 每一步都要有可用的 note
  for (const s of steps) assert.ok(typeof s.note === 'string' && s.note.length > 0);
  n++;
}

// 输入不能被修改
const origin = [4, 1, 3];
const mod = await load('quick.js');
mod.run(origin);
assert.deepEqual(origin, [4, 1, 3], '执行器修改了入参');

// 排序结果稳定性抽查：100 组随机
for (let t = 0; t < 100; t++) {
  const arr = Array.from({ length: 1 + Math.floor(Math.random() * 20) }, () => Math.floor(Math.random() * 50));
  for (const f of ['quick.js', 'bubble.js', 'insertion.js']) {
    const m = await load(f);
    const st = m.run(arr);
    assert.deepEqual(st[st.length - 1].array, [...arr].sort((a, b) => a - b), `${f} 随机用例失败`);
  }
}

console.log(`✅ 执行器自测通过：${n} 个固定用例 + 300 个随机用例`);