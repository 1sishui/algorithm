/**
 * 应用入口：把「知识图谱 → 算法执行器 → 渲染器 → 播放器 → 诊断/评估」串起来。
 *
 * 这个文件只做装配，不写算法、不画图、不拼提示词。
 * 想加功能时，先想清楚该改哪个模块，再动手。
 */
import { algorithms, findByKnowledgePoint } from './algorithms/registry.js';
import { createArrayBars } from './render/arrayBars.js';
import { createTreeView } from './render/treeView.js';
import { createGraphView } from './render/graphView.js';
import { buildTree } from './algorithms/tree/model.js';
import { parseEdgeList } from './algorithms/graph/model.js';
import { Player } from './core/player.js';
import { categories, nodeById, recommend, categoryOfKp } from './knowledge/graph.js';
import { diagnose } from './diagnosis/rules.js';
import { diagnoseWithLLM, checkHealth, explainFailure } from './llm/client.js';
import { createDiagnosisView } from './ui/diagnosisPanel.js';
import { createMastery } from './ui/mastery.js';
import { runUserCode, TEMPLATE } from './user/runner.js';
import { computeFeatures } from './assessment/features.js';
import { computeSubmissionFeatures } from './assessment/submissions.js';
import { normalizeRecords, summarizeSubmissions, difficultyLabel } from './import/luogu.js';
import { syncLuoguWithCookie, fetchRecordCode, fetchProblemTags } from './import/luoguClient.js';
import { requestAnalysis, renderReport } from './agent/report.js';
import { classifyCodes } from './agent/codeTags.js';
import {
  pushRecord,
  loadRecords,
  saveRecords,
  clearAll,
  summarize,
  serialize,
  describe,
  groupBy
} from './user/history.js';

const $ = (id) => document.getElementById(id);

const el = {
  select: $('algo-select'),
  input: $('input-data'),
  regenerate: $('btn-regenerate'),
  bars: $('bars'),
  prev: $('btn-prev'),
  play: $('btn-play'),
  next: $('btn-next'),
  progress: $('progress'),
  stepText: $('step-text'),
  speed: $('speed'),
  note: $('note'),
  compare: $('m-compare'),
  swap: $('m-swap'),
  depth: $('m-depth'),
  index: $('m-index'),
  kg: $('kg'),
  mastery: $('mastery'),
  masterySource: $('mastery-source'),
  recommend: $('recommend'),
  code: $('code-input'),
  diagnoseBtn: $('btn-diagnose'),
  diagnosis: $('diagnosis'),
  healthBtn: $('btn-health'),
  health: $('health'),
  progressText: $('progress-text'),
  lblA: $('lbl-a'),
  lblB: $('lbl-b'),
  lblC: $('lbl-c'),
  inputWrap: $('input-wrap'),
  inputLabel: $('input-label'),
  mycode: $('mycode'),
  userCode: $('user-code'),
  runCode: $('btn-run-code'),
  templateBtn: $('btn-template'),
  clearCode: $('btn-clear-code'),
  codeStatus: $('user-code-status'),
  historyCount: $('history-count'),
  historySummary: $('history-summary'),
  historyList: $('history-list'),
  historyStats: $('history-stats'),
  exportRuns: $('btn-export-runs'),
  clearRuns: $('btn-clear-runs'),
  luogu: $('luogu'),
  luoguSummary: $('luogu-summary'),
  cookieClientId: $('cookie-client-id'),
  cookieUid: $('cookie-uid'),
  cookieExtra: $('cookie-extra'),
  saveCookie: $('btn-save-cookie'),
  syncDoingBtn: $('btn-sync-doing'),
  analyzeProfileBtn: $('btn-analyze-profile'),
  clearCookie: $('btn-clear-cookie'),
  cookieStatus: $('cookie-status'),
  analyzeStatus: $('analyze-status'),
  analyzeBody: $('analyze-body'),
  algoDetailBody: $('algo-detail-body')
};

/** 下拉框里的“我的代码”入口 */
const USER_ALGO = {
  id: 'user.code',
  name: '我的代码（自己写）',
  brief: '在下方输入框里写 run(a, viz)',
  view: 'array'
};
const menu = [...algorithms, USER_ALGO];

const ARRAY_DEFAULT = '5, 2, 9, 1, 7, 3, 8';
const TREE_DEFAULT = '4, 2, 6, 1, 3, 5, 7';
const GRAPH_DEFAULT = 'A-B, A-C, B-D, C-D, D-E, E-F, C-F';

let renderer = null;
let skipFirstRecord = true; // 页面刚打开时的首次生成不计入记录
const mastery = createMastery(el.mastery);

/** 算法清单，供特征计算算“同类覆盖度” */
const catalog = algorithms.map((algo) => ({
  name: algo.name,
  category: categoryOfKp(algo.kp) || '未分类'
}));

let lastDims = null;
let lastStats = null;

function refreshFeatures() {
  const runResult = computeFeatures(runs, catalog);
  const subResult = computeSubmissionFeatures(submissions);

  // 有洛谷数据就优先用洛谷口径，没有的维度回退到运行记录
  const dims = {};
  for (const key of Object.keys(runResult.dims)) {
    const fromSub = subResult && subResult.dims ? subResult.dims[key] : null;
    dims[key] = fromSub && fromSub.value != null ? fromSub : runResult.dims[key];
  }

  mastery.render(dims);
  lastDims = dims;
  lastStats = {
    submissions: subResult ? subResult.sample : 0,
    problems: subResult ? subResult.problems : 0,
    runs: runResult.sample,
    sessions: runResult.sessions,
    solved: subResult && subResult.dims ? null : null
  };
  renderAlgoDetail();
  const parts = [];
  if (subResult && subResult.sample) parts.push(`${subResult.sample} 条洛谷提交`);
  if (runResult.sample) parts.push(`${runResult.sample} 条运行记录`);

  if (parts.length === 0) {
    el.masterySource.textContent = '还没有数据：跑几次算法，或者导入洛谷记录';
    return;
  }
  el.masterySource.textContent = `基于 ${parts.join(' + ')} 推算`;
}

let currentAlgo = algorithms[0];

/** 按算法的 view 切换渲染器：数组柱状图 / SVG 树 / SVG 图 */
function ensureRenderer(view) {
  if (renderer && renderer.view === view) return renderer;
  el.bars.innerHTML = '';
  el.bars.classList.toggle('tree-mode', view === 'tree' || view === 'graph');
  if (view === 'tree') renderer = createTreeView(el.bars);
  else if (view === 'graph') renderer = createGraphView(el.bars);
  else renderer = createArrayBars(el.bars);
  return renderer;
}

const player = new Player({
  onStep: (step, index) => {
    renderer.render(step);
    el.note.textContent = step.note;

    const metrics = step.metrics || {};
    el.compare.textContent = metrics.comparisons ?? metrics.visited ?? 0;
    el.swap.textContent = metrics.swaps ?? metrics.pushed ?? metrics.discovered ?? 0;
    el.depth.textContent =
      step.depth ?? (step.stack ? step.stack.length : step.frontier ? step.frontier.length : 0);

    el.index.textContent = index;
    el.progress.value = String(index);
    el.stepText.textContent = `${index + 1} / ${player.total}`;
  },
  onState: (st) => {
    el.play.textContent = st.playing ? '暂停' : '播放';
    el.prev.disabled = st.index <= 0;
    el.next.disabled = st.total === 0 || st.index >= st.total - 1;
    el.progress.max = String(Math.max(0, st.total - 1));
    el.progressText.textContent = st.total === 0 ? '未开始' : `${st.index + 1} / ${st.total} 步`;
  }
});

/* ---------------- 输入与生成 ---------------- */

function parseInput(text) {
  const nums = String(text)
    .split(/[,\s，、]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));

  if (nums.length === 0) return [5, 2, 9, 1, 7, 3, 8];
  return nums.slice(0, 60).map((n) => Math.round(n));
}

/** 层序数组 → 二叉树；null / 空 / none 表示空位 */
function parseTreeInput(text) {
  const parts = String(text)
    .split(/[,\s，、]+/)
    .filter(Boolean);

  const values = parts.slice(0, 31).map((part) => {
    if (/^(null|none|空|-)$/i.test(part)) return null;
    const num = Number(part);
    return Number.isFinite(num) ? Math.round(num) : null;
  });

  if (values.length === 0) return buildTree([4, 2, 6, 1, 3, 5, 7]);
  return buildTree(values);
}

function build() {
  if (currentAlgo.id === USER_ALGO.id) {
    el.mycode.open = true;
    runMyCode();
    return;
  }

  const view = currentAlgo.view || 'array';
  ensureRenderer(view);

  // 切换指标名称：数组看比较/交换，树看访问/入栈，图看访问/发现
  const isTree = view === 'tree';
  const isGraph = view === 'graph';
  const isNodeView = isTree || isGraph;

  el.lblA.textContent = isNodeView ? '已访问' : '比较次数';
  el.lblB.textContent = isTree ? '入栈次数' : isGraph ? '发现次数' : '交换次数';
  el.lblC.textContent = isTree ? '栈内元素' : isGraph ? '待访问' : '递归深度';

  if (isTree) el.inputLabel.textContent = '层序数组（null 表示空位）';
  else if (isGraph) el.inputLabel.textContent = '边列表（如 A-B, A-C）';
  else el.inputLabel.textContent = '输入（逗号分隔）';

  const tree = isTree ? parseTreeInput(el.input.value) : null;
  if (isTree) renderer.setTree(tree);

  const graph = isGraph ? parseEdgeList(el.input.value) || currentAlgo.graph : null;
  if (isGraph) renderer.setGraph(graph);

  const input = parseInput(el.input.value);
  const started = performance.now();
  const steps = isTree ? currentAlgo.run(tree) : isGraph ? currentAlgo.run(graph) : currentAlgo.run(input);
  const elapsed = Math.round(performance.now() - started);

  player.load(steps);
  el.speed.value = String(player.speed);

  const last = steps[steps.length - 1];
  const metrics = (last && last.metrics) || {};
  if (skipFirstRecord) {
    skipFirstRecord = false;
    return;
  }
  addRun({
    at: new Date().toISOString(),
    algorithm: currentAlgo.name,
    kp: currentAlgo.kp || null,
    category: categoryOfKp(currentAlgo.kp) || '未分类',
    kind: isGraph ? 'graph' : isTree ? 'tree' : 'builtin',
    size: isGraph
      ? graph.nodes.length
      : isTree
        ? last && last.visited
          ? last.visited.length
          : 0
        : input.length,
    steps: steps.length,
    comparisons: isNodeView ? null : metrics.comparisons ?? null,
    swaps: isNodeView ? null : metrics.swaps ?? null,
    ms: elapsed,
    error: null
  });
}

/* ---------------- 算法下拉框 ---------------- */

algorithms.forEach((algo) => {
  const option = document.createElement('option');
  option.value = algo.id;
  option.textContent = `${algo.name}（${algo.brief}）`;
  el.select.appendChild(option);
});

const userOption = document.createElement('option');
userOption.value = USER_ALGO.id;
userOption.textContent = `${USER_ALGO.name}（${USER_ALGO.brief}）`;
el.select.appendChild(userOption);

el.select.value = currentAlgo.id;

el.select.addEventListener('change', () => {
  currentAlgo = menu.find((algo) => algo.id === el.select.value) || algorithms[0];

  // 切换视图时，如果输入还是另一边的默认值，就给个像样的示例
  const current = el.input.value.trim();
  if (currentAlgo.view === 'tree' && (current === ARRAY_DEFAULT || current === GRAPH_DEFAULT)) {
    el.input.value = TREE_DEFAULT;
  } else if (currentAlgo.view === 'graph' && (current === ARRAY_DEFAULT || current === TREE_DEFAULT)) {
    el.input.value = GRAPH_DEFAULT;
  } else if (currentAlgo.view !== 'tree' && currentAlgo.view !== 'graph' && current === TREE_DEFAULT) {
    el.input.value = ARRAY_DEFAULT;
  }

  build();
  markActiveKnowledgePoint();
});

/* ---------------- 我的代码 ---------------- */

const CODE_KEY = 'algo-agent:usercode';

function setCodeStatus(text, kind) {
  el.codeStatus.textContent = text;
  el.codeStatus.className = kind === 'ok' ? 'ok' : kind === 'bad' ? 'bad' : 'muted';
}

function persistCode() {
  try {
    localStorage.setItem(CODE_KEY, el.userCode.value);
  } catch {
    /* 隐私模式下写不了，忽略 */
  }
}

function runMyCode() {
  ensureRenderer('array');
  el.lblA.textContent = '比较次数';
  el.lblB.textContent = '交换次数';
  el.lblC.textContent = '递归深度';
  el.inputWrap.classList.remove('hidden');

  const input = parseInput(el.input.value);
  const started = performance.now();
  const result = runUserCode(el.userCode.value, input);
  const elapsed = Math.round(performance.now() - started);

  persistCode();

  if (!result.ok) {
    setCodeStatus(result.error, 'bad');
    addRun({
      at: new Date().toISOString(),
      algorithm: '我的代码',
      kp: null,
      category: '自定义',
      kind: 'user',
      size: input.length,
      steps: result.steps ? result.steps.length : 0,
      comparisons: null,
      swaps: null,
      ms: elapsed,
      error: result.error
    });
    if (result.steps && result.steps.length > 0) {
      player.load(result.steps);
      el.note.textContent = result.error;
    }
    return;
  }

  const last = result.steps[result.steps.length - 1];
  player.load(result.steps);
  setCodeStatus(`运行成功，共 ${result.steps.length} 步`, 'ok');
  addRun({
    at: new Date().toISOString(),
    algorithm: '我的代码',
    kp: null,
    category: '自定义',
    kind: 'user',
    size: input.length,
    steps: result.steps.length,
    comparisons: last.metrics.comparisons,
    swaps: last.metrics.swaps,
    ms: elapsed,
    error: null
  });
}

try {
  el.userCode.value = localStorage.getItem(CODE_KEY) || TEMPLATE;
} catch {
  el.userCode.value = TEMPLATE;
}

el.runCode.addEventListener('click', () => {
  currentAlgo = USER_ALGO;
  el.select.value = USER_ALGO.id;
  runMyCode();
});

el.templateBtn.addEventListener('click', () => {
  el.userCode.value = TEMPLATE;
  setCodeStatus('已插入示例，点「运行我的代码」', 'muted');
});

el.clearCode.addEventListener('click', () => {
  el.userCode.value = '';
  setCodeStatus('', 'muted');
});

/* ---------------- 运行记录 ---------------- */

let runs = [];
try {
  runs = loadRecords(localStorage);
} catch {
  runs = [];
}

function escapeText(str) {
  return String(str).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function renderRuns() {
  const stats = summarize(runs);
  el.historyCount.textContent = String(stats.count);
  el.historySummary.textContent = stats.count
    ? `平均 ${stats.avgSteps} 步 · 平均比较 ${stats.avgComparisons} 次` + (stats.errors ? ` · 出错 ${stats.errors} 次` : '')
    : '还没有记录';

  el.historyList.innerHTML = runs
    .slice(0, 8)
    .map((record) => {
      const time = String(record.at || '').slice(11, 19);
      const cls = record.error ? ' class="err"' : '';
      return `<li${cls}><span class="time">${time}</span>${escapeText(describe(record))}</li>`;
    })
    .join('');

  renderStats();
}

function renderStats() {
  const groups = groupBy(runs).slice(0, 4);
  if (groups.length === 0) {
    el.historyStats.innerHTML = '';
    return;
  }

  const max = Math.max(...groups.map((g) => g.count));
  el.historyStats.innerHTML = groups
    .map((group) => {
      const width = Math.round((group.count / max) * 100);
      const compare = group.avgComparisons === null ? '' : ` · 比较 ${group.avgComparisons}`;
      return `
        <div class="stat-row" title="平均 ${group.avgSteps} 步${compare} · 平均 ${group.avgMs} ms">
          <span class="stat-name">${escapeText(group.algorithm)}</span>
          <span class="stat-track"><span class="stat-fill" style="width:${width}%"></span></span>
          <span class="stat-val">${group.count} 次${group.errors ? `（错 ${group.errors}）` : ''}</span>
        </div>`;
    })
    .join('');
}

function addRun(entry) {
  runs = pushRecord(runs, entry);
  saveRecords(localStorage, runs);
  renderRuns();
  refreshFeatures();
}

el.exportRuns.addEventListener('click', () => {
  const blob = new Blob([serialize(runs)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `运行记录-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

/* ---------------- AI 诊断 ---------------- */

let analyzing = false;

function setAnalyzeStatus(text, kind) {
  el.analyzeStatus.textContent = text;
  el.analyzeStatus.className = kind === 'ok' ? 'ok' : kind === 'bad' ? 'bad' : 'muted';
}

async function runAnalysis() {
  if (analyzing) return;
  if (!lastDims) {
    setAnalyzeStatus('还没有可分析的数据', 'bad');
    return;
  }

  const dims = {};
  for (const [key, item] of Object.entries(lastDims)) {
    dims[key] = item && item.value != null ? Math.round(item.value) : null;
  }

  analyzing = true;
  setAnalyzeStatus('模型分析中…', 'muted');

  const algorithms = computeAlgorithmStats();
  const response = await requestAnalysis(dims, lastStats || {}, algorithms);
  analyzing = false;

  if (!response.ok) {
    const reason = response.reason || '';
    const hint =
      reason === 'offline_file' ? '离线版不连模型'
      : reason === 'no_api_key' ? '服务端没配 key'
      : reason === 'timeout' ? '模型超时'
      : response.message || '分析失败';
    setAnalyzeStatus(hint, 'bad');
    return;
  }

  renderReport(el.analyzeBody, response.result);
  setAnalyzeStatus('已更新', 'ok');
}

el.clearRuns.addEventListener('click', () => {
  clearAll(localStorage);
  runs = [];
  renderRuns();
  refreshFeatures();
});

/* ---------------- 洛谷：绑定 + 两个动作 ---------------- */

const LUOGU_KEY = 'algo-agent:submissions';
const CLIENT_ID_KEY = 'algo-agent:luogu-client-id';
const UID_KEY = 'algo-agent:luogu-uid';
const PID_TAGS_KEY = 'algo-agent:pid-tags';

let submissions = [];
let pidTags = {};
let clientId = '';
let luoguUid = '';

try {
  const raw = localStorage.getItem(LUOGU_KEY);
  const parsed = raw ? JSON.parse(raw) : [];
  submissions = Array.isArray(parsed) ? parsed : [];
  pidTags = JSON.parse(localStorage.getItem(PID_TAGS_KEY) || '{}') || {};
  clientId = localStorage.getItem(CLIENT_ID_KEY) || '';
  luoguUid = localStorage.getItem(UID_KEY) || '';
} catch {
  submissions = [];
}

if (clientId) el.cookieClientId.value = clientId;
if (luoguUid) el.cookieUid.value = luoguUid;

function saveSubmissions() {
  try {
    localStorage.setItem(LUOGU_KEY, JSON.stringify(submissions));
  } catch {
    /* 忽略 */
  }
}

function savePidTags() {
  try {
    localStorage.setItem(PID_TAGS_KEY, JSON.stringify(pidTags));
  } catch {
    /* 忽略 */
  }
}

function setCookieStatus(text, kind) {
  el.cookieStatus.textContent = text;
  el.cookieStatus.className = kind === 'ok' ? 'ok' : kind === 'bad' ? 'bad' : 'muted';
}

if (clientId && luoguUid) {
  setCookieStatus(`已绑定 UID ${luoguUid}`, 'ok');
}

function readCookieForm() {
  const id = String(el.cookieClientId.value || '')
    .trim()
    .replace(/^__client_id\s*=\s*/, '');
  let uid = String(el.cookieUid.value || '')
    .trim()
    .replace(/^_uid\s*=\s*/, '');
  const extra = String(el.cookieExtra.value || '').trim();

  if (extra) {
    if (!uid) {
      const match = extra.match(/(?:^|;\s*)_uid=(\d+)/);
      if (match) uid = match[1];
    }
    if (!/^\d+$/.test(uid)) return { error: '请填写 _uid（或用整行 Cookie 里带 _uid）' };
    return { id: id || '（整行）', uid, cookie: extra };
  }

  if (!id) return { error: '请填写 __client_id 的值' };
  if (!/^\d+$/.test(uid)) return { error: '_uid 应该是纯数字（个人主页 /user/ 后面那串）' };
  return { id, uid, cookie: `__client_id=${id}; _uid=${uid}` };
}

/** 校验并记住绑定信息；失败时返回 null */
function ensureBinding() {
  const form = readCookieForm();
  if (form.error) {
    setCookieStatus(form.error, 'bad');
    return null;
  }
  clientId = form.id;
  luoguUid = form.uid;
  try {
    localStorage.setItem(CLIENT_ID_KEY, clientId);
    localStorage.setItem(UID_KEY, luoguUid);
  } catch {
    /* 忽略 */
  }
  return form;
}

function mergeSubmissions(incoming) {
  const map = new Map();
  for (const record of [...submissions, ...incoming]) {
    map.set(record.id || `${record.pid}-${record.submittedAt}`, record);
  }
  submissions = [...map.values()]
    .sort((a, b) => new Date(a.submittedAt || 0) - new Date(b.submittedAt || 0))
    .slice(-3000);
}

/** 概览：总量 + 难度分布 + 算法分布 */
function renderLuoguSummary() {
  if (submissions.length === 0) {
    el.luoguSummary.innerHTML = '';
    return;
  }

  const stats = summarizeSubmissions(submissions);
  const max = Math.max(...stats.histogram.slice(1), 1);

  const diffRows = [];
  for (let level = 1; level <= 7; level += 1) {
    const count = stats.histogram[level] || 0;
    if (count === 0) continue;
    diffRows.push(`
      <div class="diff-row">
        <span class="lvl">${difficultyLabel(level)}</span>
        <span class="track"><span class="fill" style="width:${Math.round((count / max) * 100)}%"></span></span>
        <span class="cnt">${count}</span>
      </div>`);
  }

  // 算法分布：只统计「通过了的题」，按题目标签归并
  const solvedPids = [...new Set(submissions.filter((r) => r.accepted).map((r) => r.pid).filter(Boolean))];
  const algoCount = new Map();
  for (const pid of solvedPids) {
    for (const tag of new Set(pidTags[pid] || [])) {
      algoCount.set(tag, (algoCount.get(tag) || 0) + 1);
    }
  }
  const taggedCount = solvedPids.filter((pid) => (pidTags[pid] || []).length > 0).length;
  const algoList = [...algoCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const algoMax = Math.max(...algoList.map(([, n]) => n), 1);
  const algoRows = algoList.map(
    ([tag, count]) => `
      <div class="diff-row">
        <span class="lvl">${escapeText(tag)}</span>
        <span class="track"><span class="fill" style="width:${Math.round((count / algoMax) * 100)}%"></span></span>
        <span class="cnt">${count}</span>
      </div>`
  );

  el.luoguSummary.innerHTML = `
    <div class="luogu-stats">
      <span>提交 <b>${stats.submissions}</b></span>
      <span>题目 <b>${stats.problems}</b></span>
      <span>通过 <b>${stats.solved}</b></span>
      <span>通过率 <b>${(stats.acceptRate * 100).toFixed(0)}%</b></span>
      <span>已通过题目标签 <b>${taggedCount}/${stats.solved}</b></span>
    </div>
    <div class="diff-bars">${diffRows.join('')}</div>
    ${
      algoRows.length
        ? `<div class="luogu-subtitle">算法分布（按题目）</div><div class="diff-bars">${algoRows.join('')}</div>`
        : `<div class="algo-empty">${
            taggedCount === 0
              ? '还没有题目标签，点「同步做题情况」会自动抓取。'
              : '已抓取的题目里都没有算法标签（多为未评定题目）。'
          }</div>`
    }`;
}

/** 拉记录（自动翻页） */
async function syncPages(form) {
  const result = await syncLuoguWithCookie(form.uid, form.cookie, {
    maxPages: 200,
    onProgress: (page, got, total) => {
      const tail = typeof total === 'number' ? ` / 共 ${total} 条` : '';
      setCookieStatus(`同步记录：第 ${page} 页，已拿到 ${got} 条${tail}`, 'muted');
    }
  });

  const normalized = normalizeRecords(result.records || []);
  if (normalized.length > 0) {
    mergeSubmissions(normalized);
    saveSubmissions();
  }
  return { ok: result.ok, error: result.error, added: normalized.length };
}

/** 抓题目标签：只抓「通过了的题」，没做出来的题标签说明不了他会什么 */
async function syncTags(form) {
  const pids = [...new Set(submissions.filter((r) => r.accepted).map((r) => r.pid).filter(Boolean))];
  // 没抓过（undefined）的才需要抓；抓过但确实没标签（[]）不重复打扰洛谷
  const need = pids.filter((pid) => pidTags[pid] === undefined);
  if (need.length === 0) {
    return { ok: true, added: 0, failed: 0, total: pids.length, tagged: pids.filter((p) => (pidTags[p] || []).length).length };
  }

  let done = 0;
  let ok = 0;
  const failed = [];

  const grab = async (pid) => {
    const result = await fetchProblemTags(pid, form.cookie);
    if (result && result.ok) {
      pidTags[pid] = result.tags || [];
      return true;
    }
    return false;
  };

  for (const pid of need) {
    if (await grab(pid)) ok += 1;
    else failed.push(pid);
    done += 1;
    if (done % 5 === 0 || done === need.length) {
      setCookieStatus(`抓取题目标签 ${done}/${need.length}，失败 ${failed.length}`, 'muted');
    }
    await new Promise((resolve) => setTimeout(resolve, 160));
  }

  // 失败的重试一轮（多为瞬时限流）
  if (failed.length > 0) {
    const retry = [...failed];
    failed.length = 0;
    for (const pid of retry) {
      if (await grab(pid)) ok += 1;
      else failed.push(pid);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  savePidTags();
  const tagged = pids.filter((p) => (pidTags[p] || []).length > 0).length;
  return { ok: true, added: ok, failed: failed.length, total: pids.length, tagged };
}

/** 动作一：同步做题情况（只统计，不调用模型） */
async function syncDoing() {
  const form = ensureBinding();
  if (!form) return;

  el.syncDoingBtn.disabled = true;
  try {
    setCookieStatus('同步记录中…', 'muted');
    const records = await syncPages(form);
    if (!records.ok) {
      setCookieStatus(`同步失败：${(records.error && records.error.message) || '未知原因'}`, 'bad');
      return;
    }

    const tags = await syncTags(form);
    renderLuoguSummary();
    refreshFeatures();

    const stats = summarizeSubmissions(submissions);
    setCookieStatus(
      `已同步 ${records.added} 条提交，共 ${stats.problems} 道题（通过 ${stats.solved} 道）；` +
        `已通过题的标签覆盖 ${tags.tagged}/${tags.total} 道` +
        (tags.failed ? `，${tags.failed} 道抓取失败（可再点一次重试）` : ''),
      tags.failed ? 'bad' : 'ok'
    );
  } finally {
    el.syncDoingBtn.disabled = false;
  }
}

/** 动作二：分析个人情况（抓代码 → 归类 → 模型诊断） */
async function analyzeProfile() {
  const form = ensureBinding();
  if (!form) return;

  const health = await checkHealth();
  if (!health.ok || !health.data.key_configured) {
    setCookieStatus('需要先在 .env 里配置模型 key，才能做个人分析', 'bad');
    return;
  }

  if (submissions.length === 0) {
    setCookieStatus('还没有做题记录，先点「同步做题情况」', 'bad');
    return;
  }

  el.analyzeProfileBtn.disabled = true;
  try {
    await fetchCodesForAnalysis(form);
    await classifyCollectedCodes();
    refreshFeatures();

    setCookieStatus('模型分析中…', 'muted');
    await runAnalysis();
    setCookieStatus('分析完成', 'ok');
  } finally {
    el.analyzeProfileBtn.disabled = false;
  }
}

/** 抓代码：只抓「多次提交」的题，每题最多 5 次，总量可控 */
async function fetchCodesForAnalysis(form, maxProblems = 12, perProblem = 5) {
  const byProblem = new Map();
  for (const record of submissions) {
    if (!byProblem.has(record.pid)) byProblem.set(record.pid, []);
    byProblem.get(record.pid).push(record);
  }

  const targets = [...byProblem.values()]
    .filter((list) => list.length >= 2)
    .slice(-maxProblems)
    .map((list) => list.slice(-perProblem));

  const total = targets.reduce((sum, list) => sum + list.filter((r) => !r.code).length, 0);
  if (total === 0) return;

  let done = 0;
  let ok = 0;
  for (const list of targets) {
    for (const record of list) {
      if (record.code) continue;
      const result = await fetchRecordCode(record.id, form.cookie);
      if (result && result.ok && result.code) {
        record.code = result.code;
        ok += 1;
      }
      done += 1;
      setCookieStatus(`抓取代码 ${done}/${total}`, 'muted');
      await new Promise((resolve) => setTimeout(resolve, 220));
    }
  }

  saveSubmissions();
  if (ok === 0) setCookieStatus('没能抓到代码（可能记录不可见）', 'bad');
}

/**
 * 把已抓到的代码分批交给模型打标签（每批 6 段，最多 5 批）。
 * 结果写在 record.algoTags / algoReason 上。
 */
async function classifyCollectedCodes() {
  const pending = submissions.filter((r) => r.code && !(Array.isArray(r.algoTags) && r.algoTags.length));
  if (pending.length === 0) return;

  const batchSize = 6;
  const queue = pending.slice(0, batchSize * 5);
  let done = 0;
  let tagged = 0;

  for (let i = 0; i < queue.length; i += batchSize) {
    const batch = queue.slice(i, i + batchSize);
    const result = await classifyCodes(batch.map((r) => ({ id: r.id, code: r.code })));

    if (!result.ok) {
      setCookieStatus(`代码归类失败：${result.message || result.reason || '未知原因'}`, 'bad');
      break;
    }

    const byId = new Map(result.results.map((item) => [String(item.id), item]));
    for (const record of batch) {
      const found = byId.get(String(record.id));
      if (found && found.algorithms && found.algorithms.length) {
        record.algoTags = found.algorithms;
        record.algoReason = found.reason || '';
        tagged += 1;
      }
      done += 1;
    }

    saveSubmissions();
    setCookieStatus(`代码归类 ${done}/${queue.length}，已标 ${tagged} 段`, 'muted');
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  saveSubmissions();
}

/** 展示“凭什么这么判断”：每道题用的算法 + 模型给的依据 */
function renderAlgoDetail() {
  if (!el.algoDetailBody) return;

  const latest = new Map();
  for (const record of submissions) {
    if (Array.isArray(record.algoTags) && record.algoTags.length > 0) {
      latest.set(record.pid, record);
    }
  }

  if (latest.size === 0) {
    el.algoDetailBody.innerHTML =
      '<div class="algo-empty">还没有代码归类数据。点「分析个人情况」后会自动生成。</div>';
    return;
  }

  const rows = [...latest.values()].slice(-20).reverse();
  el.algoDetailBody.innerHTML =
    `<div class="algo-empty">共 ${latest.size} 道题完成代码归类，显示最近 ${rows.length} 道</div>` +
    rows
      .map(
        (record) => `
        <div class="algo-item">
          <span class="pid">${escapeText(record.pid || '')}</span>
          ${record.title ? `<span class="tags">${escapeText(record.title)}</span>` : ''}
          · <span class="tags">${escapeText(record.algoTags.join('、'))}</span>
          ${record.algoReason ? `<span class="reason">依据：${escapeText(record.algoReason)}</span>` : ''}
        </div>`
      )
      .join('');
}

/** 按算法聚合：优先看“代码实际用的算法”，没有代码时才退回题目标签 */
function computeAlgorithmStats() {
  const byProblem = new Map();
  for (const record of submissions) {
    if (!record.pid) continue;
    if (!byProblem.has(record.pid)) byProblem.set(record.pid, { attempts: 0, solved: false });
    const item = byProblem.get(record.pid);
    item.attempts += 1;
    if (record.accepted) item.solved = true;
  }

  const codeTagged = submissions.filter((r) => Array.isArray(r.algoTags) && r.algoTags.length > 0);
  const usingCode = codeTagged.length > 0;

  const perProblem = new Map();
  for (const record of codeTagged) {
    if (!perProblem.has(record.pid)) perProblem.set(record.pid, []);
    perProblem.get(record.pid).push(record.algoTags);
  }

  const codeTagsByProblem = new Map();
  let multiSolution = 0;
  for (const [pid, tagSets] of perProblem) {
    codeTagsByProblem.set(pid, tagSets[tagSets.length - 1]);
    const unique = new Set(tagSets.map((tags) => [...tags].sort().join('/')));
    if (unique.size > 1) multiSolution += 1;
  }

  const byTag = new Map();
  for (const [pid, info] of byProblem) {
    const tags = usingCode ? codeTagsByProblem.get(pid) : pidTags[pid];
    if (!tags || tags.length === 0) continue;
    for (const tag of new Set(tags)) {
      if (!byTag.has(tag)) byTag.set(tag, { tag, problems: 0, solved: 0, attempts: 0 });
      const entry = byTag.get(tag);
      entry.problems += 1;
      entry.attempts += info.attempts;
      if (info.solved) entry.solved += 1;
    }
  }

  const list = [...byTag.values()]
    .filter((entry) => entry.problems >= 2)
    .map((entry) => ({
      tag: entry.tag,
      problems: entry.problems,
      solveRate: Math.round((entry.solved / entry.problems) * 100),
      avgAttempts: Number((entry.attempts / entry.problems).toFixed(1))
    }));

  // 题目标签口径下统计的都是「已通过」的题，通过率恒为 100%，
  // 所以强弱改看「做了几道」和「平均提交几次」。
  const strong = usingCode
    ? [...list].sort((a, b) => b.solveRate - a.solveRate || a.avgAttempts - b.avgAttempts).slice(0, 4)
    : [...list].sort((a, b) => b.problems - a.problems || a.avgAttempts - b.avgAttempts).slice(0, 4);
  const weak = usingCode
    ? [...list].sort((a, b) => a.solveRate - b.solveRate || b.avgAttempts - a.avgAttempts).slice(0, 4)
    : [...list].sort((a, b) => b.avgAttempts - a.avgAttempts || a.problems - b.problems).slice(0, 4);

  return {
    source: usingCode ? 'code' : 'problem',
    strong,
    weak,
    multiSolution,
    taggedProblems: usingCode ? codeTagsByProblem.size : Object.keys(pidTags).length
  };
}

/* 两个主按钮：绑定信息在点击时校验并记住 */
el.saveCookie.addEventListener('click', () => {
  const form = ensureBinding();
  if (form) setCookieStatus('已保存绑定，可以点「同步做题情况」了', 'ok');
});

el.syncDoingBtn.addEventListener('click', syncDoing);
el.analyzeProfileBtn.addEventListener('click', analyzeProfile);

el.clearCookie.addEventListener('click', () => {
  clientId = '';
  luoguUid = '';
  try {
    localStorage.removeItem(CLIENT_ID_KEY);
    localStorage.removeItem(UID_KEY);
  } catch {
    /* 忽略 */
  }
  el.cookieClientId.value = '';
  el.cookieUid.value = '';
  el.cookieExtra.value = '';
  setCookieStatus('已解绑（已同步的数据保留）', 'muted');
});

/* ---------------- 知识图谱侧边栏 ---------------- */

function renderKnowledgeGraph() {
  el.kg.innerHTML = '';
  categories.forEach((cat) => {
    const group = document.createElement('div');
    group.className = 'kg-group';

    const title = document.createElement('div');
    title.className = 'kg-cat';
    title.textContent = cat.name;
    group.appendChild(title);

    cat.nodes.forEach((node) => {
      const btn = document.createElement('button');
      btn.className = 'kg-node';
      btn.dataset.id = node.id;
      btn.innerHTML = `<span class="dot"></span><span>${node.name}</span><span class="pct">${node.mastery}</span>`;
      btn.addEventListener('click', () => onKnowledgePointClick(node));
      group.appendChild(btn);
    });

    el.kg.appendChild(group);
  });
  markActiveKnowledgePoint();
}

function markActiveKnowledgePoint() {
  el.kg.querySelectorAll('.kg-node').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.id === currentAlgo.kp);
    const node = nodeById.get(btn.dataset.id);
    btn.classList.toggle('done', Boolean(node && node.mastery >= 80));
  });
}

function onKnowledgePointClick(node) {
  const algo = findByKnowledgePoint(node.id);
  if (algo) {
    currentAlgo = algo;
    el.select.value = algo.id;
    build();
    markActiveKnowledgePoint();
    return;
  }
  el.note.textContent = `「${node.name}」的可视化模板正在建设中（计划第 2 阶段交付），当前先跑通排序类算法。`;
}

/* ---------------- 推荐 ---------------- */

function renderRecommend() {
  const { node, why } = recommend();
  el.recommend.innerHTML = `<div class="kp">${node.name}</div><div class="why">${node.category} · ${why}</div>`;
}

/* ---------------- 诊断 ---------------- */

const diagnosisView = createDiagnosisView(el.diagnosis);

async function runDiagnosis() {
  const code = el.code.value;
  if (!code.trim()) {
    diagnosisView.error('先把代码粘进上面的输入框。');
    return;
  }

  el.diagnoseBtn.disabled = true;
  diagnosisView.loading();

  try {
    const llm = await diagnoseWithLLM({
      code,
      algorithm: currentAlgo.name,
      language: 'C++'
    });

    if (llm.ok) {
      diagnosisView.show({ result: llm.result, source: 'llm', meta: llm.meta });
    } else {
      // 关键降级路径：模型不可用时，本地规则接管，界面照常给出结论
      diagnosisView.show({
        result: diagnose(code),
        source: 'rules',
        fallback: llm
      });
    }
  } finally {
    el.diagnoseBtn.disabled = false;
  }
}

el.diagnoseBtn.addEventListener('click', runDiagnosis);

el.healthBtn.addEventListener('click', async () => {
  el.health.textContent = '正在测试连接…';
  const health = await checkHealth(true);

  if (!health.ok) {
    el.health.className = 'health bad';
    el.health.textContent = `连接失败：${explainFailure(health)}`;
    return;
  }

  const d = health.data;
  el.health.className = d.key_configured && !String(d.probe || '').startsWith('失败') ? 'health good' : 'health bad';
  el.health.innerHTML = [
    `服务 v${d.version} · 模型 ${d.model}`,
    `Key：${d.key_configured ? d.key_masked : '未配置'}`,
    `.env：${d.env_found ? '已找到' : '未找到'}`,
    d.probe ? `连接测试：${d.probe}` : ''
  ].filter(Boolean).join('<br>');
});

/* ---------------- 事件绑定 ---------------- */

el.regenerate.addEventListener('click', build);
el.prev.addEventListener('click', () => player.prev());
el.next.addEventListener('click', () => player.next());
el.play.addEventListener('click', () => player.toggle());
el.speed.addEventListener('input', () => player.setSpeed(el.speed.value));
el.progress.addEventListener('input', () => {
  player.pause();
  player.seek(el.progress.value);
});

document.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (event.code === 'Space') {
    event.preventDefault();
    player.toggle();
  }
  if (event.code === 'ArrowRight') player.next();
  if (event.code === 'ArrowLeft') player.prev();
});

/* ---------------- 播放到结尾时的知识点提示 ---------------- */

let lastEndIndex = -1;
setInterval(() => {
  if (player.atEnd && player.total > 0 && lastEndIndex !== player.index) {
    lastEndIndex = player.index;
    const node = nodeById.get(currentAlgo.kp);
    if (node) node.mastery = Math.min(100, node.mastery + 1);
    markActiveKnowledgePoint();
    renderRecommend();
  }
}, 600);

/* ---------------- 启动 ---------------- */

renderKnowledgeGraph();
renderRecommend();
renderRuns();
renderLuoguSummary();
renderAlgoDetail();
refreshFeatures();
build();

diagnosisView.show({
  result: diagnose('int a[10]; for (int i = 0; i <= n; i++) { a[i] = 0; }'),
  source: 'rules'
});