/**
 * 洛谷数据客户端
 *
 * 页面不直接连洛谷（没有 CORS 头），而是调本地服务 /api/luogu，
 * 由本机去取公开记录再返回。只读，不涉及登录态。
 */
const ENDPOINT = '/api/luogu';
const USER_ENDPOINT = '/api/luogu/user';
const TIMEOUT = 15000;

/**
 * 查 UID 对应的公开资料，用来在导入前让用户确认“这是不是我”。
 * 只读昵称/头像，不涉及任何凭证。
 */
export async function fetchLuoguUser(uid) {
  if (typeof location !== 'undefined' && location.protocol === 'file:') {
    return { ok: false, reason: 'offline_file', message: '离线版没有本地服务' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const response = await fetch(`${USER_ENDPOINT}?uid=${encodeURIComponent(uid)}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });

    if (response.status === 404 || response.status === 501) {
      return { ok: false, reason: 'stale_server', message: '当前服务是旧版本，请重启 启动.bat' };
    }
    if (!response.ok) return { ok: false, reason: `http_${response.status}`, message: `服务返回 ${response.status}` };

    const data = await response.json();
    if (!data || !data.ok) {
      return { ok: false, reason: (data && data.reason) || 'unknown', message: (data && data.message) || '' };
    }
    return { ok: true, name: data.name, uid: data.uid, avatar: data.avatar };
  } catch (error) {
    return { ok: false, reason: error.name === 'AbortError' ? 'timeout' : 'network', message: '连不上本地服务' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 带 Cookie 同步（可读私有记录）
 *
 * Cookie 只发给本机服务 /api/luogu/records，由本机转发给洛谷；
 * 其它任何地方都收不到它。
 */
export async function syncLuoguWithCookie(uid, cookie, options = {}) {
  const maxPages = options.maxPages ?? 3;
  const all = [];
  let total = null;

  for (let page = 1; page <= maxPages; page += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);

    let data = null;
    try {
      const response = await fetch('/api/luogu/records', {
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
        error: { message: error.name === 'AbortError' ? '请求超时' : '连不上本地服务' }
      };
    } finally {
      clearTimeout(timer);
    }

    if (!data || !data.ok) {
      return { ok: all.length > 0, records: all, error: { message: (data && data.message) || '同步失败', reason: data && data.reason } };
    }

    if (typeof data.count === 'number') total = data.count;
    all.push(...(data.records || []));
    if (options.onProgress) options.onProgress(page, all.length, total);

    if ((data.records || []).length < (data.perPage || 20)) break;
  }

  return { ok: true, records: all, total };
}

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

    // 404/501 说明端口上跑的是旧版服务（没有 /api/luogu 这个路由）
    if (response.status === 404 || response.status === 501) {
      return {
        ok: false,
        reason: 'stale_server',
        message: '当前服务是旧版本（没有洛谷接口）。请关掉那个黑窗口，重新双击「启动.bat」'
      };
    }

    if (!response.ok) {
      return { ok: false, reason: `http_${response.status}`, message: `本地服务返回 ${response.status}` };
    }

    let data = null;
    try {
      data = await response.json();
    } catch {
      return { ok: false, reason: 'bad_response', message: '本地服务返回的不是 JSON，可能还是旧版本' };
    }

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