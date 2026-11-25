/**
 * 洛谷数据客户端（仅 Cookie 方式）
 *
 * 前端不直接连洛谷：Cookie 只发给本机服务 /api/luogu/records，
 * 由本机转发给洛谷，其它任何地方都拿不到它。
 */
const ENDPOINT = '/api/luogu/records';
const TIMEOUT = 20000;

/**
 * @param {string} uid 洛谷 UID
 * @param {string} cookie 形如 "__client_id=xxx; _uid=123"
 * @param {{maxPages?: number, onProgress?: (page:number, got:number, total:number|null)=>void}} options
 */
export async function syncLuoguWithCookie(uid, cookie, options = {}) {
  // 一直翻到没有新记录为止；maxPages 只是保险丝，防止接口异常时死循环
  const maxPages = options.maxPages ?? 200;
  const all = [];
  let total = null;
  let page = 1;

  while (page <= maxPages) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);

    let data = null;
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, page, cookie }),
        signal: controller.signal
      });

      if (response.status === 404 || response.status === 501) {
        return { ok: false, records: all, error: { message: '当前服务是旧版本，请重启 启动.bat' } };
      }
      data = await response.json();
    } catch (error) {
      return {
        ok: false,
        records: all,
        error: { message: error.name === 'AbortError' ? '请求超时' : '连不上本地服务，确认 启动.bat 的窗口开着' }
      };
    } finally {
      clearTimeout(timer);
    }

    if (!data || !data.ok) {
      return {
        ok: all.length > 0,
        records: all,
        error: { message: (data && data.message) || '同步失败', reason: data && data.reason }
      };
    }

    if (typeof data.count === 'number') total = data.count;
    all.push(...(data.records || []));
    if (options.onProgress) options.onProgress(page, all.length, total);

    const got = (data.records || []).length;
    if (got === 0) break;

    // 已知总数时算一下还要翻几页，避免无意义的空请求
    if (typeof total === 'number' && all.length >= total) break;
    if (got < (data.perPage || 20)) break;

    page += 1;
    // 给洛谷留点喘息时间，别把人家打急了
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  return { ok: true, records: all, total };
}