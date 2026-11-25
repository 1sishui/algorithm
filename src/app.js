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
import { syncLuoguWithCookie } from './import/luoguClient.js';
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
  syncLuoguBtn: $('btn-sync-luogu'),
  clearCookie: $('btn-clear-cookie'),
  cookieStatus: $('cookie-status')
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

el.clearRuns.addEventListener('click', () => {
  clearAll(localStorage);
  runs = [];
  renderRuns();
  refreshFeatures();
});

/* ---------------- 洛谷数据（Cookie 绑定） ---------------- */

const LUOGU_KEY = 'algo-agent:submissions';
const CLIENT_ID_KEY = 'algo-agent:luogu-client-id';
const UID_KEY = 'algo-agent:luogu-uid';

let submissions = [];
let clientId = '';
let luoguUid = '';

try {
  const raw = localStorage.getItem(LUOGU_KEY);
  const parsed = raw ? JSON.parse(raw) : [];
  submissions = Array.isArray(parsed) ? parsed : [];
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

function setCookieStatus(text, kind) {
  el.cookieStatus.textContent = text;
  el.cookieStatus.className = kind === 'ok' ? 'ok' : kind === 'bad' ? 'bad' : 'muted';
}

if (clientId && luoguUid) {
  setCookieStatus(`已保存 __client_id（${clientId.length} 字符），UID ${luoguUid}`, 'ok');
}

function renderLuoguSummary() {
  if (submissions.length === 0) {
    el.luoguSummary.innerHTML = '';
    return;
  }

  const stats = summarizeSubmissions(submissions);
  const max = Math.max(...stats.histogram.slice(1), 1);

  const rows = [];
  for (let level = 1; level <= 7; level += 1) {
    const count = stats.histogram[level] || 0;
    if (count === 0) continue;
    rows.push(`
      <div class="diff-row">
        <span class="lvl">${difficultyLabel(level)}</span>
        <span class="track"><span class="fill" style="width:${Math.round((count / max) * 100)}%"></span></span>
        <span class="cnt">${count}</span>
      </div>`);
  }

  el.luoguSummary.innerHTML = `
    <div class="luogu-stats">
      <span>提交 <b>${stats.submissions}</b></span>
      <span>题目 <b>${stats.problems}</b></span>
      <span>通过 <b>${stats.solved}</b></span>
      <span>通过率 <b>${(stats.acceptRate * 100).toFixed(0)}%</b></span>
      <span>跨度 <b>${(stats.firstAt || '').slice(0, 10)} ~ ${(stats.lastAt || '').slice(0, 10)}</b></span>
    </div>
    <div class="diff-bars">${rows.join('')}</div>`;
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

function readCookieForm() {
  const id = String(el.cookieClientId.value || '')
    .trim()
    .replace(/^__client_id\s*=\s*/, '');
  let uid = String(el.cookieUid.value || '')
    .trim()
    .replace(/^_uid\s*=\s*/, '');
  const extra = String(el.cookieExtra.value || '').trim();

  // 高级模式：整行 Cookie 优先，UID 从里面兜底解析
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

async function syncLuoguNow({ full = false, quiet = false } = {}) {
  const form = readCookieForm();
  if (form.error) {
    setCookieStatus(form.error, 'bad');
    return;
  }

  clientId = form.id;
  luoguUid = form.uid;
  try {
    localStorage.setItem(CLIENT_ID_KEY, clientId);
    localStorage.setItem(UID_KEY, luoguUid);
  } catch {
    /* 忽略 */
  }

  if (!quiet) setCookieStatus('同步中…', 'muted');

  const result = await syncLuoguWithCookie(form.uid, form.cookie, {
    // full：一直翻到最后一页；增量：只拉前 2 页看有没有新提交
    maxPages: full ? 200 : 2,
    onProgress: (page, got, total) => {
      if (quiet) return;
      const tail = typeof total === 'number' ? ` / 共 ${total} 条` : '';
      setCookieStatus(`同步中… 第 ${page} 页，已拿到 ${got} 条${tail}`, 'muted');
    }
  });

  const normalized = normalizeRecords(result.records || []);
  if (normalized.length > 0) {
    mergeSubmissions(normalized);
    saveSubmissions();
    renderLuoguSummary();
    refreshFeatures();
  }

  if (!result.ok) {
    const message = (result.error && result.error.message) || '同步失败';
    setCookieStatus(`${message}${normalized.length ? `（已拿到 ${normalized.length} 条）` : ''}`, 'bad');
    return;
  }

  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  setCookieStatus(`已同步 ${normalized.length} 条 · ${time}`, 'ok');
}

el.saveCookie.addEventListener('click', () => syncLuoguNow({ full: true }));
el.syncLuoguBtn.addEventListener('click', () => syncLuoguNow({ full: false }));

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
  setCookieStatus('Cookie 已从本机删除（已导入的数据保留）', 'muted');
});

// 每 10 分钟静默同步一次第一页，页面在后台时跳过
setInterval(() => {
  if (!clientId || !luoguUid || document.visibilityState !== 'visible') return;
  syncLuoguNow({ full: false, quiet: true });
}, 10 * 60 * 1000);
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
refreshFeatures();
build();

// 已经保存过 Cookie 的，启动后静默同步一次第一页
if (clientId && luoguUid) {
  setTimeout(() => syncLuoguNow({ full: false, quiet: true }), 2500);
}
diagnosisView.show({
  result: diagnose('int a[10]; for (int i = 0; i <= n; i++) { a[i] = 0; }'),
  source: 'rules'
});