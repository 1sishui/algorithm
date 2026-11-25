/**
 * AI 诊断：把六维数字交给大模型，让它写一份人话诊断
 *
 * 分工很明确：
 *   - 数字由本地规则算（可复现、可解释）
 *   - 解读由模型写（它能说“这说明什么、接下来练什么”，规则写不出这种话）
 */
const ENDPOINT = '/api/analyze';
const TIMEOUT = 30000;

function escapeHtml(str) {
  return String(str).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

export async function requestAnalysis(dims, stats) {
  if (typeof location !== 'undefined' && location.protocol === 'file:') {
    return { ok: false, reason: 'offline_file' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dims, stats }),
      signal: controller.signal
    });

    if (response.status === 404 || response.status === 501) {
      return { ok: false, reason: 'stale_server', message: '当前服务是旧版本，请重启 启动.bat' };
    }

    const data = await response.json();
    if (!data || !data.ok) {
      return { ok: false, reason: (data && data.reason) || 'unknown', message: (data && data.message) || '' };
    }
    return { ok: true, result: data.result, meta: data.meta || {} };
  } catch (error) {
    return {
      ok: false,
      reason: error.name === 'AbortError' ? 'timeout' : 'network',
      message: error.name === 'AbortError' ? '模型响应超时' : '连不上本地服务'
    };
  } finally {
    clearTimeout(timer);
  }
}

export function renderReport(container, report) {
  const list = (items, cls) =>
    items && items.length
      ? `<div class="report-block ${cls}"><h4>${cls === 'good' ? '优势' : cls === 'bad' ? '短板' : '建议'}</h4><ul>${items
          .map((item) => `<li>${escapeHtml(item)}</li>`)
          .join('')}</ul></div>`
      : '';

  container.innerHTML = `
    ${report.summary ? `<div class="report-summary">${escapeHtml(report.summary)}</div>` : ''}
    ${list(report.strengths, 'good')}
    ${list(report.weaknesses, 'bad')}
    ${list(report.suggestions, 'plain')}
    ${report.correctionProfile ? `<div class="report-profile">纠错风格：${escapeHtml(report.correctionProfile)}</div>` : ''}
  `;
}