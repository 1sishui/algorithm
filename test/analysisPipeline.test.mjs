// 逻辑自测：分析任务的分步计划、预计耗时、断点续跑
// 不开浏览器、不发网络请求，只验证「数据 → 还差多少 / 从哪续」算得对不对。
import assert from 'node:assert/strict';
import {
  buildPlan,
  classifyQueue,
  createJob,
  createJobStore,
  currentStepId,
  describeResume,
  estimateJobSeconds,
  estimateStepSeconds,
  formatEta,
  isJobComplete,
  normalizeTagEntry,
  pickCodeTargets,
  stepPercent,
  tagNeedsFetch,
  updateStep
} from '../src/agent/analysisPipeline.js';

/* ---------- 标签格式兼容 ---------- */

assert.deepEqual(normalizeTagEntry(undefined), { tags: [], checked: false }, '没有标签记录时应该算未抓过');
assert.deepEqual(normalizeTagEntry(['模拟', '2005', 'NOIP 普及组']), { tags: ['模拟'], checked: true }, '老数组格式要过滤噪音标签');
assert.deepEqual(normalizeTagEntry([]), { tags: [], checked: false }, '老格式的空数组要重新抓一次');
assert.deepEqual(normalizeTagEntry(['2005']), { tags: [], checked: false }, '只剩噪音标签等于没抓到');
assert.equal(normalizeTagEntry({ tags: [], checked: true }).checked, true, 'checked=true 表示查过了（洛谷确实没标签）');
assert.equal(normalizeTagEntry({ tags: ['图论'] }).checked, true, '有标签但没有 checked 标记，算查过');
assert.equal(tagNeedsFetch(undefined), true);
assert.equal(tagNeedsFetch({ tags: [], checked: true }), false);
assert.equal(tagNeedsFetch(['模拟']), false);

/* ---------- 抓代码的目标筛选 ---------- */

function record(pid, id, patch = {}) {
  return { pid, id, accepted: false, submittedAt: `2026-11-01T00:00:0${id || 0}Z`, ...patch };
}

const submissions = [
  record('P1001', 1, { code: 'int main(){}', algoTags: ['模拟'] }),
  record('P1001', 2),
  record('P1001', 3),
  record('P1002', 4), // 只提交过一次，不抓代码
  record('P1003', 5),
  record('P1003', 6),
  record('P1003', 7),
  record('P1003', 8),
  record('P1003', 9),
  record('P1003', 10)
];

const targets = pickCodeTargets(submissions);
assert.equal(targets.length, 2, '只抓提交过两次以上的题');
assert.ok(
  targets.every((list) => list.length <= 5),
  '每题最多 5 次'
);
const p1003 = targets.find((list) => list[0].pid === 'P1003');
assert.deepEqual(
  p1003.map((item) => item.id),
  [6, 7, 8, 9, 10],
  '取每题最近 5 次'
);

/* ---------- 待归类队列 ---------- */

assert.equal(classifyQueue(submissions).length, 0, '已经标过算法的代码不该重复归类');
assert.equal(
  classifyQueue([{ id: 1, pid: 'A', code: 'x' }, { id: 2, pid: 'B', code: 'y' }]).length,
  2,
  '有代码但没标签的才进队列'
);
assert.equal(
  classifyQueue(Array.from({ length: 40 }, (_, i) => ({ id: i, pid: `P${i}`, code: 'x' }))).length,
  30,
  '一次最多归类 30 段，别悄悄放大模型花费'
);

/* ---------- 分步计划 ---------- */

const plan = buildPlan({
  submissions,
  pidTags: { P1001: { tags: ['模拟'], checked: true } },
  syncedAt: 1730000000000
});

assert.equal(plan.tags.total, 3, '三题里有记录');
assert.equal(plan.tags.done, 1);
assert.equal(plan.tags.remaining, 2);
assert.equal(plan.tags.tagged, 1);
assert.equal(plan.codes.total, 8, 'P1001 三条 + P1003 最近五条');
assert.equal(plan.codes.done, 1, '已经带代码的那条不用再抓');
assert.equal(plan.codes.remaining, 7);
assert.equal(plan.labels.total, 0, '队列里没有待归类的');
assert.equal(plan.classify.total, 7, '归类这一步的总工作量 = 待抓代码 + 待归类');
assert.equal(plan.records.total, 10);
assert.equal(plan.model.remaining, 1);

// 同样的数据重复算，结果必须一样（否则「继续」会重复干活）
assert.deepEqual(
  buildPlan({ submissions, pidTags: { P1001: { tags: ['模拟'], checked: true } }, syncedAt: 1730000000000 }),
  plan,
  'plan 必须是纯函数，重复调用结果一致'
);

/* ---------- 预计耗时 ---------- */

assert.equal(formatEta(0), '');
assert.equal(formatEta(5), '不到 10 秒');
assert.equal(formatEta(100), '约 2 分钟');

assert.equal(estimateStepSeconds('tags', { done: 0, total: 100, remaining: 100 }), 100);
assert.equal(estimateStepSeconds('model', {}), 20, '模型步骤给固定经验值');

// 跑到 5 项、用了 10 秒 → 实测 2 秒/项，剩 50 项应该估 100 秒
const running = {
  status: 'running',
  kind: 'tags',
  done: 5,
  total: 55,
  remaining: 50,
  startedAt: Date.now() - 10000
};
const measured = estimateStepSeconds('tags', running);
assert.ok(measured >= 99 && measured <= 101, `实测外推不对：${measured}`);

// 标签步骤的 done 是总体进度（400/421），速率要用本次实际抓的 3 道算，否则 ETA 会偏低
const tagRunning = {
  status: 'running',
  kind: 'tags',
  done: 400,
  total: 421,
  remaining: 21,
  rateDone: 3,
  startedAt: Date.now() - 6000
};
const tagEta = estimateStepSeconds('tags', tagRunning);
assert.ok(tagEta >= 40 && tagEta <= 44, `标签速率口径不对：${tagEta}`);

// 一次卡顿不能把预计时间放大到离谱：最多 3 倍经验值
const lagging = {
  status: 'running',
  kind: 'tags',
  done: 2,
  total: 102,
  remaining: 100,
  startedAt: Date.now() - 600000
};
assert.ok(estimateStepSeconds('tags', lagging) <= 300, 'ETA 要有上限');

// 归类没进入子阶段时，抓代码和归类分别估
const classifyPlan = estimateStepSeconds('classify', {
  status: 'pending',
  codes: { remaining: 10 },
  labels: { remaining: 10 }
});
assert.ok(classifyPlan > 0);
assert.equal(
  Math.round(classifyPlan),
  Math.round(10 * 0.55 + 10 * 2.0),
  '归类估时要按两个子阶段相加'
);

/* ---------- 任务状态与续跑 ---------- */

const job = createJob(1000);
assert.equal(currentStepId(job), 'records', '新任务从抓记录开始');
assert.equal(job.status, 'running');

updateStep(job, 'records', { status: 'done', done: 421, total: 421, elapsedMs: 12000 });
assert.equal(currentStepId(job), 'tags');

updateStep(job, 'tags', { status: 'failed', done: 12, total: 30, error: '网络断了' });
job.current = 'tags';
job.status = 'failed';
assert.equal(describeResume(job), '抓标签 12/30');
assert.equal(isJobComplete(job), false);

// 继续：只补没完成的，已完成步骤不再计入总预计
job.status = 'running';
const beforeResume = estimateJobSeconds(job, 2000);
updateStep(job, 'tags', { status: 'done' });
const afterResume = estimateJobSeconds(job, 2000);
assert.ok(beforeResume > afterResume, '完成一步后总预计应该下降');

// 全部完成后不再需要「继续」
for (const id of ['classify', 'model']) updateStep(job, id, { status: 'done' });
assert.equal(isJobComplete(job), true);
assert.equal(currentStepId(job), null);

/* ---------- 进度百分比 ---------- */

assert.equal(stepPercent({ done: 6, total: 30 }), 20);
assert.equal(stepPercent({ done: 0, total: 0 }), 0, '总数未知时不假装有进度');
assert.equal(stepPercent({ done: 30, total: 30 }), 100);
assert.equal(stepPercent({ done: 99, total: 30 }), 100, '不能超过 100%');

/* ---------- 断点存储 ---------- */

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key)
  };
}

const storage = fakeStorage();
const store = createJobStore(storage);
store.saveJob(job);
assert.equal(store.loadJob().startedAt, 1000, '任务状态要能读回来');
assert.equal(store.loadReport(), null);

store.saveReport({ at: 1234, result: { summary: '测试报告' } });
assert.equal(store.loadReport().result.summary, '测试报告');

store.clearJob();
assert.equal(store.loadJob(), null);

// 版本不一致就丢弃，避免老格式把界面算崩
storage.setItem('algo-agent:analysis-job', JSON.stringify({ version: 0, steps: {} }));
assert.equal(store.loadJob(), null);

// 拿不到 localStorage（隐私模式）时不能让分析直接挂掉
const empty = createJobStore(null);
assert.equal(empty.loadJob(), null);
assert.equal(empty.saveJob(job), false);
empty.clearJob();
empty.saveReport({ result: {} });
assert.equal(empty.loadReport(), null);

console.log('analysisPipeline 自测通过 ✓');