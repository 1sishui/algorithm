/**
 * 洛谷做题记录：解析与统计
 *
 * 为什么要“导入”而不是“自动同步”：
 *   洛谷没有公开的提交记录 API，跨域也拿不到登录态数据。
 *   所以走的是「用户在自己浏览器里导出 → 本地导入」的路子：
 *   数据始终在用户手里，不需要把账号 Cookie 交给任何服务器。
 *
 * 解析器故意写得很宽容：不同页面/版本字段名不一样（status/verdict、pid/problem.pid……），
 * 只要是“一条提交一个对象”的数组，都能尽量认出来。
 */

/** 洛谷状态码 → 统一判定 */
export const STATUS_MAP = {
  0: '等待中',
  1: '等待中',
  2: '编译错误',
  3: '输出超限',
  4: '内存超限',
  5: '超时',
  6: '运行错误',
  7: '答案错误',
  12: '通过',
  14: '未通过'
};

const AC_LABELS = new Set(['通过', 'Accepted', 'AC', 'ac']);

function pick(obj, keys, fallback = undefined) {
  for (const key of keys) {
    const value = key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), obj);
    if (value !== undefined && value !== null) return value;
  }
  return fallback;
}

/** 把一条原始记录整理成统一结构 */
export function normalizeRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const pid = String(pick(raw, ['problem.pid', 'pid', 'problemId'], '')).trim();
  const statusValue = pick(raw, ['status', 'verdict', 'result'], '');
  const status = STATUS_MAP[statusValue] || String(statusValue || '未知');

  const timeRaw = pick(raw, ['submitTime', 'time', 'createTime', 'timestamp'], null);
  let submittedAt = null;
  if (typeof timeRaw === 'number') {
    // 秒级时间戳自动换算
    submittedAt = new Date(timeRaw < 1e12 ? timeRaw * 1000 : timeRaw).toISOString();
  } else if (typeof timeRaw === 'string' && timeRaw.length > 0) {
    const parsed = new Date(timeRaw);
    submittedAt = Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  if (!pid && !submittedAt) return null;

  return {
    id: String(pick(raw, ['id', 'rid'], '') || `${pid}-${submittedAt || ''}`),
    pid,
    title: String(pick(raw, ['problem.title', 'title', 'problemName'], '')).trim(),
    difficulty: Number(pick(raw, ['problem.difficulty', 'difficulty'], 0)) || 0,
    status,
    accepted: AC_LABELS.has(status),
    submittedAt,
    language: String(pick(raw, ['language', 'lang', 'languageName'], '')).trim()
  };
}

export function normalizeRecords(rawList) {
  if (!Array.isArray(rawList)) return [];
  const seen = new Set();
  const out = [];

  for (const raw of rawList) {
    const record = normalizeRecord(raw);
    if (!record) continue;
    const key = record.id || `${record.pid}-${record.submittedAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(record);
  }

  return out.sort((a, b) => new Date(a.submittedAt || 0) - new Date(b.submittedAt || 0));
}

const DIFFICULTY_LABELS = {
  0: '未评定',
  1: '入门',
  2: '普及−',
  3: '普及/提高−',
  4: '普及+/提高',
  5: '提高+/省选−',
  6: '省选/NOI−',
  7: 'NOI/NOI+/CTSC'
};

export function difficultyLabel(level) {
  return DIFFICULTY_LABELS[level] || `难度 ${level}`;
}

/** 导入后给用户看的概览 */
export function summarizeSubmissions(records) {
  const list = records || [];
  const problems = new Map();

  for (const record of list) {
    const key = record.pid || record.title || record.id;
    if (!problems.has(key)) problems.set(key, { attempts: 0, accepted: false, difficulty: record.difficulty || 0 });
    const item = problems.get(key);
    item.attempts += 1;
    if (record.accepted) item.accepted = true;
    if (!item.difficulty && record.difficulty) item.difficulty = record.difficulty;
  }

  const solved = [...problems.values()].filter((item) => item.accepted).length;
  const histogram = new Array(8).fill(0);
  for (const item of problems.values()) {
    const level = Math.max(0, Math.min(7, Number(item.difficulty) || 0));
    histogram[level] += 1;
  }

  const dates = list.map((r) => r.submittedAt).filter(Boolean).sort();
  const acceptedCount = list.filter((r) => r.accepted).length;

  return {
    submissions: list.length,
    problems: problems.size,
    solved,
    acceptRate: list.length ? acceptedCount / list.length : 0,
    firstAt: dates[0] || null,
    lastAt: dates[dates.length - 1] || null,
    histogram,
    languages: [...new Set(list.map((r) => r.language).filter(Boolean))]
  };
}
/**
 * 给用户在洛谷页面控制台里跑的抓取脚本。
 * 放在 JS 常量里而不是直接写进 HTML，避免 < 之类的字符被当成标签。
 * 它做三件事：读自己的 uid → 分页拉提交记录 → 下载成 luogu-records.json。
 */
export const BOOKMARKLET = `(async () => {
  const data = window._feInjection ? JSON.parse(decodeURIComponent(window._feInjection)) : null;
  const uid = (data && data.currentData && data.currentData.user && data.currentData.user.uid)
    || location.pathname.split('/').filter(Boolean).pop();
  const all = [];
  for (let page = 1; page <= 30; page++) {
    const res = await fetch('/record/list?user=' + uid + '&page=' + page + '&_contentOnly=1', {
      headers: { 'x-luogu-type': 'content-only' }
    });
    const json = await res.json();
    const box = (json.currentData && json.currentData.records) || json.records || json;
    const list = (box && box.result) || [];
    if (!list.length) break;
    all.push(...list);
    console.log('已抓取第 ' + page + ' 页，累计 ' + all.length + ' 条');
    if (list.length < ((box && box.perPage) || 20)) break;
  }
  const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'luogu-records.json';
  a.click();
  console.log('完成，共 ' + all.length + ' 条，文件已开始下载');
})();`;

export const IMPORT_HINT = '在洛谷任意页面按 F12 → Console，粘贴上面这段脚本回车，会下载一个 luogu-records.json。';
