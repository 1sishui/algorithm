/**
 * 代码算法归类：判断“这段代码实际用了什么算法”
 *
 * 为什么不直接用题目标签：一题多解。同一道题有人写 DP，有人写暴力枚举，
 * 题目标签只说明“这题能考什么”，不说明“这个人会什么”。
 */
const ENDPOINT = '/api/code-tags';
const TIMEOUT = 45000;

export async function classifyCodes(items) {
  if (!items || items.length === 0) return { ok: false, reason: 'empty' };
  if (typeof location !== 'undefined' && location.protocol === 'file:') {
    return { ok: false, reason: 'offline_file' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
      signal: controller.signal
    });

    if (response.status === 404 || response.status === 501) {
      return { ok: false, reason: 'stale_server', message: '当前服务是旧版本，请重启 启动.bat' };
    }

    const data = await response.json();
    if (!data || !data.ok) {
      return { ok: false, reason: (data && data.reason) || 'unknown', message: (data && data.message) || '' };
    }
    return { ok: true, results: data.results || [] };
  } catch (error) {
    return {
      ok: false,
      reason: error.name === 'AbortError' ? 'timeout' : 'network',
      message: error.name === 'AbortError' ? '模型超时' : '连不上本地服务'
    };
  } finally {
    clearTimeout(timer);
  }
}