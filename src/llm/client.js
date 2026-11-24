/**
 * 大模型诊断客户端
 *
 * 只做三件事：发请求、超时、把结果归一化。
 * 任何失败都不抛异常，而是返回 { ok:false, reason, status, detail }，让调用方静默降级到本地规则。
 */
const ENDPOINT = '/api/diagnose';
const HEALTH_ENDPOINT = '/api/health';
const DEFAULT_TIMEOUT = 25000;

export async function diagnoseWithLLM(input, options = {}) {
  // 离线版（file:// 打开）没有服务端，直接走本地规则，省掉一次必然失败的请求
  if (typeof location !== 'undefined' && location.protocol === 'file:') {
    return { ok: false, reason: 'offline_file' };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: input.code,
        problem: input.problem || '',
        algorithm: input.algorithm || '',
        language: input.language || 'C++'
      }),
      signal: controller.signal
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      return {
        ok: false,
        reason: `http_${response.status}`,
        status: response.status,
        detail: (data && (data.message || data.reason)) || ''
      };
    }

    if (!data || !data.ok) {
      return {
        ok: false,
        reason: (data && data.reason) || 'unknown',
        status: response.status,
        detail: (data && data.message) || ''
      };
    }

    if (!data.result || typeof data.result.question !== 'string') {
      return { ok: false, reason: 'bad_result', status: response.status };
    }

    return { ok: true, result: data.result, meta: data.meta || {} };
  } catch (error) {
    if (error.name === 'AbortError') return { ok: false, reason: 'timeout' };
    return { ok: false, reason: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/** 连接自检：读服务端的配置状态；probe=true 时会真的调一次模型（消耗几十个 token） */
export async function checkHealth(probe = false) {
  if (typeof location !== 'undefined' && location.protocol === 'file:') {
    return { ok: false, reason: 'offline_file' };
  }
  try {
    const response = await fetch(HEALTH_ENDPOINT + (probe ? '?probe=1' : ''), {
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) return { ok: false, reason: `http_${response.status}` };
    return { ok: true, data: await response.json() };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

/** 把失败原因翻译成给用户看的一句话；带 status/detail 时一并显示，方便排查 */
export function explainFailure(failure) {
  const info = typeof failure === 'string' ? { reason: failure } : failure || {};
  const reason = info.reason || 'unknown';
  const detail = String(info.detail || '');

  // 上游的具体错误优先翻译，比通用文案有用得多
  if (/insufficient balance|余额不足|quota exceeded/i.test(detail)) {
    return `账户余额不足，需要充值（${detail.slice(0, 40)}）`;
  }
  if (/authentication fails|invalid.*api key|incorrect api key/i.test(detail)) {
    return 'key 无效或已过期，请重新复制一份';
  }
  if (/rate limit|too many requests/i.test(detail)) {
    return '请求太频繁，被平台限流了，等一分钟再试';
  }

  const map = {
    offline_file: '当前是离线版，不连模型',
    no_api_key: '服务端没有配置 key（检查 .env 是否放对位置）',
    network: '连不上诊断服务（服务没启动，或端口被别的程序占用）',
    timeout: '模型响应超时',
    rate_limited: '调用太频繁',
    upstream_error: '模型接口报错（key 可能无效、欠费或被限流）',
    bad_output: '模型返回的内容解析不了',
    bad_result: '模型返回的字段不完整',
    unknown: '未知原因'
  };

  let text = map[reason];
  if (!text) {
    if (reason.startsWith('http_')) {
      text = `诊断服务返回 ${reason.slice(5)}（旧版服务没有接口，重启一次即可）`;
    } else {
      text = `未知原因：${reason}`;
    }
  }

  if (info.detail) text += `（${String(info.detail).slice(0, 60)}）`;
  return text;
}