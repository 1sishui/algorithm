/**
 * 分析任务的分步计划与断点状态（纯逻辑）
 *
 * 这里只回答三个问题，不碰 DOM、不发请求：
 *   1. 按现在手里的数据，每一步还差多少？
 *   2. 每步大概还要多久？
 *   3. 上次跑到哪、下次从哪接着跑？
 *
 * 界面（ui/analysisProgress.js）只负责把这些数字画出来；
 * 真正的抓取和调用在 app.js。因为不依赖浏览器，本文件可以直接在 Node 里测
 * （test/analysisPipeline.test.mjs），续跑逻辑坏了 CI 会先拦住。
 */
import { isNoiseTag } from '../knowledge/tagCategories.js';

export const JOB_KEY = 'algo-agent:analysis-job';
export const REPORT_KEY = 'algo-agent:last-report';
export const JOB_VERSION = 1;

export const STEP_IDS = ['records', 'tags', 'classify', 'model'];

export const STEP_LABELS = {
  records: '抓记录',
  tags: '抓标签',
  classify: '归类代码',
  model: '模型分析'
};

/** 经验值：每项大概多少秒。只在没有实测数据时用，跑到几项后就改用实测外推 */
export const UNIT_SECONDS = {
  // 记录是每页 20 条一起回来的，按「条」算要小一个量级
  records: 0.05,
  tags: 1.0,
  codes: 0.55,
  classify: 2.0
};

/** 模型只有一次请求，给个固定经验值 */
export const FIXED_SECONDS = { model: 20 };

/** 归类阶段最多把多少段代码交给模型（和原来的上限保持一致，别悄悄放大花费） */
export const MAX_CLASSIFY = 30;

/**
 * 兼容两种历史格式：老数据是字符串数组，新数据是 { tags, categories, checked }
 * 返回 { tags, checked }，tags 已过滤掉年份/比赛来源这类噪音标签。
 */
export function normalizeTagEntry(value) {
  if (!value) return { tags: [], checked: false };
  if (Array.isArray(value)) {
    // 老格式没有 checked 标记：抓到过标签就算查过，空数组要重新抓一次
    const tags = value.filter((tag) => !isNoiseTag(tag));
    return { tags, checked: tags.length > 0 };
  }
  const tags = (Array.isArray(value.tags) ? value.tags : []).filter((tag) => !isNoiseTag(tag));
  const checked = value.checked === true || tags.length > 0;
  return { tags, checked };
}

/** 这道题还要不要去洛谷补抓标签（和 app.js 里的判断口径保持一致） */
export function tagNeedsFetch(value) {
  if (value === undefined) return true;
  return !normalizeTagEntry(value).checked;
}

/** 标签进度：总共多少题、已经查过多少、查出了多少、还差多少 */
export function countTagProgress(pidTags, pids) {
  let total = 0;
  let checked = 0;
  let tagged = 0;
  let need = 0;

  for (const pid of pids) {
    total += 1;
    const entry = normalizeTagEntry(pidTags[pid]);
    if (entry.checked) checked += 1;
    else need += 1;
    if (entry.tags.length > 0) tagged += 1;
  }

  return { total, checked, tagged, need, empty: total - tagged };
}

/** 取「同一道题多次提交」里最近若干道、每题最近若干次；和原来抓代码的口径一致 */
export function pickCodeTargets(submissions, { maxProblems = 12, perProblem = 5 } = {}) {
  const byProblem = new Map();
  for (const record of submissions || []) {
    if (!record || !record.pid) continue;
    if (!byProblem.has(record.pid)) byProblem.set(record.pid, []);
    byProblem.get(record.pid).push(record);
  }

  return [...byProblem.values()]
    .filter((list) => list.length >= 2)
    .slice(-maxProblems)
    .map((list) => list.slice(-perProblem));
}

/** 待归类的代码：有代码、但还没被模型打上算法标签，最多 30 段 */
export function classifyQueue(submissions, limit = MAX_CLASSIFY) {
  const pending = (submissions || []).filter(
    (record) => record && record.code && !(Array.isArray(record.algoTags) && record.algoTags.length > 0)
  );
  return pending.slice(0, limit);
}

/**
 * 根据当前 localStorage 里的数据算出「每步还差多少」。
 * 这是续跑的唯一依据：数据本身就是断点，不额外记一套账。
 */
export function buildPlan({ submissions = [], pidTags = {}, syncedAt = 0, hasReport = false } = {}) {
  const pids = [...new Set((submissions || []).map((record) => record && record.pid).filter(Boolean))];
  const tags = countTagProgress(pidTags || {}, pids);

  const codeRecords = pickCodeTargets(submissions).flat();
  const codes = {
    total: codeRecords.length,
    done: codeRecords.filter((record) => record.code).length,
    remaining: codeRecords.filter((record) => !record.code).length
  };

  const queue = classifyQueue(submissions);
  const labels = {
    // total 是「本轮队列长度」，不是「历史上一共归过多少段」，和界面上的 6/30 对得上
    total: queue.length,
    done: queue.filter((record) => Array.isArray(record.algoTags) && record.algoTags.length > 0).length,
    remaining: queue.filter((record) => !(Array.isArray(record.algoTags) && record.algoTags.length > 0)).length
  };

  return {
    pids,
    records: {
      // 翻页前不知道服务器上一共多少条，先用本地已知条数当预计基数
      done: 0,
      total: (submissions || []).length,
      remaining: (submissions || []).length,
      known: (submissions || []).length
    },
    tags: { done: tags.checked, total: tags.total, remaining: tags.need, tagged: tags.tagged, empty: tags.empty },
    codes,
    labels,
    classify: {
      done: 0,
      total: codes.remaining + labels.remaining,
      remaining: codes.remaining + labels.remaining,
      codes,
      labels,
      kind: null
    },
    model: { done: 0, total: 1, remaining: 1, hasReport: Boolean(hasReport) }
  };
}

export function createJob(now = Date.now()) {
  return {
    version: JOB_VERSION,
    startedAt: now,
    updatedAt: now,
    finishedAt: 0,
    status: 'running',
    current: null,
    error: '',
    steps: STEP_IDS.reduce((steps, id) => {
      steps[id] = {
        status: 'pending',
        done: 0,
        total: 0,
        remaining: null,
        detail: '',
        error: '',
        kind: null,
        startedAt: 0,
        elapsedMs: 0
      };
      return steps;
    }, {})
  };
}

export function updateStep(job, id, patch, now = Date.now()) {
  if (!job || !job.steps || !job.steps[id]) return job;
  job.steps[id] = { ...job.steps[id], ...patch };
  job.updatedAt = now;
  return job;
}

/** 第一个还没跑完的步骤；全跑完返回 null */
export function currentStepId(job) {
  if (!job || !job.steps) return null;
  for (const id of STEP_IDS) {
    const step = job.steps[id];
    if (step && step.status !== 'done' && step.status !== 'skipped') return id;
  }
  return null;
}

export function isJobComplete(job) {
  return Boolean(job) && currentStepId(job) === null;
}

/** 「继续分析」按钮上的一句话：停在 归类代码 12/30 */
export function describeResume(job) {
  if (!job || !job.current) return '';
  const label = STEP_LABELS[job.current] || '';
  const step = job.steps && job.steps[job.current];
  if (step && Number(step.total) > 0) return `${label} ${step.done}/${step.total}`;
  return label;
}

/** 把秒数说成人话；宁可粗一点，也别给一个假装精确的数字 */
export function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 10) return '不到 10 秒';
  if (seconds < 60) {
    const rounded = Math.min(60, Math.ceil(seconds / 10) * 10);
    return rounded >= 60 ? '约 1 分钟' : `约 ${rounded} 秒`;
  }
  const minutes = Math.round(seconds / 60);
  return `约 ${Math.max(1, minutes)} 分钟`;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/**
 * 估算一步还要多久。
 * 前两项没有参考价值，用经验值；跑到 2 项以上且超过 0.8 秒，改用实测速率外推，
 * 并夹在经验值的 0.4–3 倍之间，防止一次网络卡顿把预计时间放大到离谱。
 */
export function estimateStepSeconds(id, step = {}, now = Date.now()) {
  if (id === 'model') return FIXED_SECONDS.model;

  // rateDone 是「本次实际处理了几项」：标签步骤的 done 是总体进度，
  // 直接拿它算速率会把之前查过的题也算进本次耗时里，ETA 会严重偏低。
  const done = Number(step.rateDone != null ? step.rateDone : step.done) || 0;
  const elapsedMs = step.status === 'running' && step.startedAt ? Math.max(0, now - step.startedAt) : 0;

  // 还没进入子阶段的归类步骤：抓代码和模型归类分别估，再相加
  if (id === 'classify' && !step.kind) {
    const codes = step.codes || {};
    const labels = step.labels || {};
    return (
      Math.max(0, Number(codes.remaining) || 0) * UNIT_SECONDS.codes +
      Math.max(0, Number(labels.remaining) || 0) * UNIT_SECONDS.classify
    );
  }

  const kind = step.kind || id;
  const unit = UNIT_SECONDS[kind] ?? 1;
  const remaining = Math.max(
    0,
    step.remaining == null ? (Number(step.total) || 0) - done : Number(step.remaining) || 0
  );
  const fallback = remaining * unit;

  if (done >= 2 && elapsedMs >= 800) {
    // elapsedMs 是毫秒，这里统一换算成秒
    const measured = ((elapsedMs / done) * remaining) / 1000;
    return clamp(measured, fallback * 0.4, fallback * 3);
  }
  return fallback;
}

/** 整个任务还要多久 */
export function estimateJobSeconds(job, now = Date.now()) {
  if (!job || !job.steps) return 0;
  let total = 0;
  for (const id of STEP_IDS) {
    const step = job.steps[id];
    if (!step || step.status === 'done' || step.status === 'skipped') continue;
    total += estimateStepSeconds(id, step, now);
  }
  return total;
}

/** 进度条的百分比；总数未知时返回 0，让界面显示不确定态 */
export function stepPercent(step) {
  const total = Number(step && step.total);
  const done = Number(step && step.done);
  if (!Number.isFinite(total) || total <= 0) return 0;
  return clamp(Math.round((done / total) * 100), 0, 100);
}

/**
 * 断点状态存取。
 * 传 null 也不报错（隐私模式 / 关掉 localStorage 时分析照样能跑，只是不能续）。
 */
export function createJobStore(storage) {
  const read = (key) => {
    try {
      const raw = storage && storage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  };

  const write = (key, value) => {
    try {
      if (!storage) return false;
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      // 多半是 5MB 配额满了；续跑信息丢了不影响本次结果，不打断用户
      return false;
    }
  };

  const remove = (key) => {
    try {
      if (storage) storage.removeItem(key);
    } catch {
      /* 忽略 */
    }
  };

  return {
    loadJob() {
      const job = read(JOB_KEY);
      if (!job || job.version !== JOB_VERSION || !job.steps) return null;
      return job;
    },
    saveJob(job) {
      return write(JOB_KEY, job);
    },
    clearJob() {
      remove(JOB_KEY);
    },
    loadReport() {
      return read(REPORT_KEY);
    },
    saveReport(report) {
      // 只留报告正文和生成时间，别把整个请求上下文塞进 5MB 里
      return write(REPORT_KEY, { at: report.at || Date.now(), result: report.result || null });
    },
    clearReport() {
      remove(REPORT_KEY);
    }
  };
}