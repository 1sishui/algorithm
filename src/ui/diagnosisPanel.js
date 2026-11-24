/**
 * 诊断结果面板：负责“加载中 / 成功 / 失败”三种显示，
 * 并在结果上标明这次是谁给的结论（大模型还是本地规则）。
 *
 * 为什么要标来源：答辩时被问到“这个结论哪来的”必须答得出来，
 * 而且评审最反感“看起来像 AI 但其实没接”。
 */
import { explainFailure } from '../llm/client.js';

function esc(str) {
  return String(str).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

export function createDiagnosisView(container) {
  function loading() {
    container.innerHTML = `<div class="diag-loading"><span class="spinner"></span>大模型正在分析代码…</div>`;
  }

  function error(message) {
    container.innerHTML = `<div class="diag-error">${esc(message)}</div>`;
  }

  function show({ result, source, meta = {}, fallback }) {
    const isLLM = source === 'llm';
    const stamp = isLLM
      ? `大模型 · ${esc(meta.model || 'unknown')} · ${meta.cached ? '缓存' : `${meta.latency_ms ?? '?'} ms`}`
      : '本地规则';

    container.innerHTML = `
      <div class="diag-head">
        <span class="src ${isLLM ? 'src-llm' : 'src-rules'}">${stamp}</span>
        ${fallback ? `<span class="fallback">${esc(explainFailure(fallback))}</span>` : ''}
      </div>
      <div class="row"><span class="k">错误类型</span><span class="type">${esc(result.label)}</span></div>
      ${result.line ? `<div class="row"><span class="k">位置</span>第 ${result.line} 行</div>` : ''}
      <div class="row"><span class="k">依据</span>${esc(result.evidence)}</div>
      <div class="row"><span class="k">引导提问</span><span class="q">${esc(result.question)}</span></div>
      ${result.hint ? `<div class="row"><span class="k">提示</span>${esc(result.hint)}</div>` : ''}
      ${result.codeLeakRemoved ? `<div class="row"><span class="k">安全</span>模型输出里疑似含完整代码，已拦截</div>` : ''}
      <details>
        <summary>查看返回结构（将来接别的模型也必须是这些字段）</summary>
        <pre>${esc(JSON.stringify(result, null, 2))}</pre>
      </details>
    `;
  }

  return { loading, show, error };
}