/**
 * 运行记录
 *
 * 这是本项目第一份「真实行为数据」：每次运行（内置算法或用户自己的代码）都记一条，
 * 包含规模、步数、比较/交换次数、耗时、是否出错。
 *
 * 现在的用途是本地统计；以后接 Supabase 时，把 saveRecords 换成写库即可，
 * 上层代码不用动。理解度评估的六维特征将来就从这类记录里算。
 */
export const STORAGE_KEY = 'algo-agent:runs';
export const MAX_RECORDS = 50;

/** 纯函数，方便测试：往列表头部插入一条并截断 */
export function pushRecord(records, record, max = MAX_RECORDS) {
  return [record, ...records].slice(0, max);
}

/** 简单统计，给面板显示用 */
export function summarize(records) {
  if (!records || records.length === 0) {
    return { count: 0, errors: 0, avgComparisons: 0, avgSteps: 0 };
  }
  const ok = records.filter((r) => !r.error);
  const avg = (list, key) =>
    list.length === 0
      ? 0
      : Math.round(list.reduce((sum, item) => sum + (Number(item[key]) || 0), 0) / list.length);

  return {
    count: records.length,
    errors: records.length - ok.length,
    avgComparisons: avg(ok, 'comparisons'),
    avgSteps: avg(ok, 'steps')
  };
}

export function loadRecords(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRecords(storage, records) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    /* 隐私模式写不进去，忽略 */
  }
}

export function clearAll(storage) {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    /* 忽略 */
  }
}

/** 导出成可读的 JSON（以后论文里的“行为日志样例”可以直接引用） */
export function serialize(records) {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      schema: 'algo-agent.runs.v1',
      records
    },
    null,
    2
  );
}

/** 一行摘要，面板用 */
export function describe(record) {
  if (record.error) return `${record.algorithm} · 出错：${record.error}`;

  const parts = [record.algorithm];
  if (record.size) parts.push(`n=${record.size}`);
  parts.push(`${record.steps} 步`);
  if (Number.isFinite(record.comparisons)) parts.push(`比较 ${record.comparisons}`);
  if (Number.isFinite(record.swaps)) parts.push(`交换 ${record.swaps}`);
  parts.push(`${record.ms} ms`);
  return parts.join(' · ');
}