/**
 * 洛谷数据客户端
 *
 * 页面不直接连洛谷（没有 CORS 头），而是调本地服务 /api/luogu，
 * 由本机去取公开记录再返回。只读，不涉及登录态。
 */
const ENDPOINT = '/api/luogu';
const TIMEOUT = 15000;

export async function fetchLuoguPage(uid, page = 1) {
  if (typeof location !== 'undefined' && location.protocol === 'file:') {
    return { ok: false, reason: 'offline_file', message: '离线版没有本地服务，请用控制台脚本导出' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const response = await fetch(`${ENDPOINT}?uid=${encodeURIComponent(uid)}&page=${page}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    const data = await response.json();
    if (!data || !data.ok) {
      return { ok: false, reason: (data && data.reason) || 'unknown', message: (data && data.message) || '' };
    }
    return { ok: true, records: data.records || [], perPage: data.perPage || 20, count: data.count };
  } catch (error) {
    return {
      ok: false,
      reason: error.name === 'AbortError' ? 'timeout' : 'network',
      message: '连不上本地服务，确认 启动.bat 的窗口还开着'
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 翻页同步。
 * @param {string} uid
 * @param {{maxPages?: number, onProgress?: (page:number, got:number, total:number|null)=>void}} options
 */
export async function syncLuogu(uid, options = {}) {
  const maxPages = options.maxPages ?? 3;
  const all = [];
  let total = null;

  for (let page = 1; page <= maxPages; page += 1) {
    const result = await fetchLuoguPage(uid, page);

    if (!result.ok) {
      return { ok: all.length > 0, records: all, error: result, total };
    }

    if (typeof result.count === 'number') total = result.count;
    all.push(...result.records);
    if (options.onProgress) options.onProgress(page, all.length, total);

    if (result.records.length < (result.perPage || 20)) break;
  }

  return { ok: true, records: all, total };
}