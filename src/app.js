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
import {
  BOOKMARKLET,
  normalizeRecords,
  summarizeSubmissions,
  difficultyLabel
} from './import/luogu.js';
import { syncLuogu, syncLuoguWithCookie, fetchLuoguUser } from './import/luoguClient.js';
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
  luoguSnippet: $('luogu-snippet'),
  copySnippet: $('btn-copy-snippet'),
  luoguFile: $('luogu-file'),
  luoguPaste: $('luogu-paste'),
  parseLuogu: $('btn-parse-luogu'),
  clearLuogu: $('btn-clear-luogu'),
  luoguStatus: $('luogu-status'),
  luoguSummary: $('luogu-summary'),
  luoguUid: $('luogu-uid'),
  bindLuogu: $('btn-bind-luogu'),
  syncLuoguBtn: $('btn-sync-luogu'),
  luoguSyncStatus: $('luogu-sync-status'),
  luoguCookie: $('luogu-cookie'),
  saveCookie: $('btn-save-cookie'),
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

/* ---------------- 洛谷导入 ---------------- */

const LUOGU_KEY = 'algo-agent:submissions';
let submissions = [];

try {
  const raw = localStorage.getItem(LUOGU_KEY);
  const parsed = raw ? JSON.parse(raw) : [];
  submissions = Array.isArray(parsed) ? parsed : [];
} catch {
  submissions = [];
}

function saveSubmissions() {
  try {
    localStorage.setItem(LUOGU_KEY, JSON.stringify(submissions));
  } catch {
    /* 忽略 */
  }
}

function setLuoguStatus(text, kind) {
  el.luoguStatus.textContent = text;
  el.luoguStatus.className = kind === 'ok' ? 'ok' : kind === 'bad' ? 'bad' : 'muted';
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

function importLuogu(rawArray) {
  const normalized = normalizeRecords(rawArray);
  if (normalized.length === 0) {
    setLuoguStatus('没解析出记录：确认文件是洛谷提交记录的 JSON 数组', 'bad');
    return;
  }

  submissions = normalized;
  saveSubmissions();
  renderLuoguSummary();
  refreshFeatures();
  setLuoguStatus(`导入 ${normalized.length} 条提交`, 'ok');
}

el.luoguSnippet.textContent = BOOKMARKLET;

el.copySnippet.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(BOOKMARKLET);
    setLuoguStatus('脚本已复制', 'ok');
  } catch {
    setLuoguStatus('浏览器不让自动复制，请手动选中上面的脚本复制', 'bad');
  }
});

el.luoguFile.addEventListener('change', () => {
  const file = el.luoguFile.files && el.luoguFile.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      importLuogu(JSON.parse(String(reader.result)));
    } catch (error) {
      setLuoguStatus(`JSON 解析失败：${error.message}`, 'bad');
    }
  };
  reader.onerror = () => setLuoguStatus('读文件失败', 'bad');
  reader.readAsText(file, 'utf-8');
});

el.parseLuogu.addEventListener('click', () => {
  const text = el.luoguPaste.value.trim();
  if (!text) {
    setLuoguStatus('先把 JSON 粘进下面的框里', 'bad');
    return;
  }
  try {
    importLuogu(JSON.parse(text));
  } catch (error) {
    setLuoguStatus(`JSON 解析失败：${error.message}`, 'bad');
  }
});

el.clearLuogu.addEventListener('click', () => {
  submissions = [];
  saveSubmissions();
  renderLuoguSummary();
  refreshFeatures();
  el.luoguPaste.value = '';
  setLuoguStatus('已清除导入数据', 'muted');
});

/* ---------------- 洛谷账号绑定（按 UID 定时同步） ---------------- */

const LUOGU_UID_KEY = 'algo-agent:luogu-uid';
const LUOGU_NAME_KEY = 'algo-agent:luogu-name';
const LUOGU_COOKIE_KEY = 'algo-agent:luogu-cookie';
let luoguUid = '';
let boundName = '';
let luoguCookie = '';

try {
  luoguUid = localStorage.getItem(LUOGU_UID_KEY) || '';
  boundName = localStorage.getItem(LUOGU_NAME_KEY) || '';
  luoguCookie = localStorage.getItem(LUOGU_COOKIE_KEY) || '';
} catch {
  luoguUid = '';
}

if (luoguUid) el.luoguUid.value = luoguUid;

function maskCookie(value) {
  if (!value) return '';
  return `${value.slice(0, 10)}…（${value.length} 字符）`;
}

function setCookieStatus(text, kind) {
  el.cookieStatus.textContent = text;
  el.cookieStatus.className = kind === 'ok' ? 'ok' : kind === 'bad' ? 'bad' : 'muted';
}

if (luoguCookie) setCookieStatus(`已保存 ${maskCookie(luoguCookie)}`, 'ok');

function setSyncStatus(text, kind) {
  el.luoguSyncStatus.textContent = text;
  el.luoguSyncStatus.className = kind === 'ok' ? 'ok' : kind === 'bad' ? 'bad' : 'muted';
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

async function syncFromLuogu({ full = false, quiet = false } = {}) {
  const uid = String(el.luoguUid.value || '').trim();
  if (!/^\d+$/.test(uid)) {
    if (!quiet) setSyncStatus('UID 应该是纯数字（个人主页网址里那一串）', 'bad');
    return;
  }

  luoguUid = uid;
  try {
    localStorage.setItem(LUOGU_UID_KEY, uid);
  } catch {
    /* 忽略 */
  }

  if (!quiet) setSyncStatus('同步中…', 'muted');

  const options = {
    maxPages: full ? 5 : 1,
    onProgress: (page, got) => {
      if (!quiet) setSyncStatus(`同步中… 第 ${page} 页，共 ${got} 条`, 'muted');
    }
  };

  const result = luoguCookie
    ? await syncLuoguWithCookie(uid, luoguCookie, options)
    : await syncLuogu(uid, options);

  const normalized = normalizeRecords(result.records || []);
  if (normalized.length > 0) {
    mergeSubmissions(normalized);
    saveSubmissions();
    renderLuoguSummary();
    refreshFeatures();
  }

  if (!result.ok) {
    const message = (result.error && result.error.message) || '同步失败';
    setSyncStatus(`${message}${normalized.length ? `（已拿到 ${normalized.length} 条）` : ''}`, 'bad');
    return;
  }

  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const who = boundName ? `${boundName} · ` : '';
  setSyncStatus(`${who}已同步 ${normalized.length} 条 · ${time}`, 'ok');
}

el.bindLuogu.addEventListener('click', bindLuoguAccount);
el.syncLuoguBtn.addEventListener('click', () => syncFromLuogu({ full: false }));
el.luoguUid.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') bindLuoguAccount();
});

el.saveCookie.addEventListener('click', async () => {
  const value = String(el.luoguCookie.value || '').trim();
  if (value.length < 10) {
    setCookieStatus('Cookie 太短，检查是不是只复制了一半', 'bad');
    return;
  }
  if (!/(^|;\s*)__client_id=/.test(value) && !/(^|;\s*)_uid=/.test(value)) {
    setCookieStatus('这串里没看到 __client_id 或 _uid，确认复制的是 Cookie 整行', 'bad');
    return;
  }

  luoguCookie = value;
  try {
    localStorage.setItem(LUOGU_COOKIE_KEY, value);
  } catch {
    setCookieStatus('浏览器不允许写入本地存储', 'bad');
    return;
  }

  el.luoguCookie.value = '';
  setCookieStatus(`已保存 ${maskCookie(value)}，正在同步…`, 'ok');
  await syncFromLuogu({ full: true });
});

el.clearCookie.addEventListener('click', () => {
  luoguCookie = '';
  try {
    localStorage.removeItem(LUOGU_COOKIE_KEY);
  } catch {
    /* 忽略 */
  }
  el.luoguCookie.value = '';
  setCookieStatus('Cookie 已从本机删除', 'muted');
});

/**
 * 绑定前先查一次资料并让用户确认。
 * 这是为了防止 UID 填错、导入了别人的做题数据——数据错了比没数据更糟。
 */
async function bindLuoguAccount() {
  const uid = String(el.luoguUid.value || '').trim();
  if (!/^\d+$/.test(uid)) {
    setSyncStatus('UID 应该是纯数字（个人主页网址里那一串）', 'bad');
    return;
  }

  setSyncStatus('正在确认账号…', 'muted');
  const info = await fetchLuoguUser(uid);

  if (info.ok) {
    const yes = window.confirm(
      `即将绑定：${info.name}（UID ${uid}）\n\n请确认这是你自己的洛谷账号。\nUID 填错会导入别人的做题数据。`
    );
    if (!yes) {
      setSyncStatus('已取消绑定', 'muted');
      return;
    }
    boundName = info.name;
    try {
      localStorage.setItem(LUOGU_NAME_KEY, boundName);
    } catch {
      /* 忽略 */
    }
  } else {
    const yes = window.confirm(
      `查不到 UID ${uid} 的资料（${info.message || info.reason || '未知原因'}）。\n\n仍然尝试同步？`
    );
    if (!yes) {
      setSyncStatus('已取消', 'muted');
      return;
    }
  }

  await syncFromLuogu({ full: true });
}

// 每 10 分钟静默拉一次第一页（只看有没有新提交），页面切到后台时跳过
setInterval(() => {
  if (!luoguUid || document.visibilityState !== 'visible') return;
  syncFromLuogu({ full: false, quiet: true });
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

// 已经绑定过 UID 的，启动后静默同步一次第一页
if (luoguUid) {
  setTimeout(() => syncFromLuogu({ full: false, quiet: true }), 2500);
}
diagnosisView.show({
  result: diagnose('int a[10]; for (int i = 0; i <= n; i++) { a[i] = 0; }'),
  source: 'rules'
});