/**
 * 数据页的分步进度条
 *
 * 只负责画：四个步骤、当前/总数、预计耗时、进度条、失败提示。
 * 「还差多少、要多久」在 agent/analysisPipeline.js 里算，「真正去抓」在 app.js。
 * 这样样式改坏了不影响续跑逻辑，谢韵也能独立调这个文件。
 */
import { STEP_IDS, STEP_LABELS, estimateStepSeconds, formatEta, stepPercent } from '../agent/analysisPipeline.js';

const COUNT_PENDING = '等待';

function countText(step) {
  if (!step) return COUNT_PENDING;
  if (step.status === 'pending') return COUNT_PENDING;
  if (step.status === 'skipped') return '跳过';

  const total = Number(step.total) || 0;
  const done = Number(step.done) || 0;

  if (step.status === 'failed') return total > 0 ? `${done} / ${total}` : '中断';
  if (step.status === 'done') return total > 0 && done < total ? `${done} / ${total}` : '已完成';
  return total > 0 ? `${done} / ${total}` : '进行中';
}

function etaText(id, step) {
  if (!step) return '';
  if (step.status === 'done') {
    const seconds = Number(step.elapsedMs) / 1000;
    return Number.isFinite(seconds) && seconds > 0 ? `用时 ${formatEta(seconds)}` : '';
  }
  if (step.status === 'failed' || step.status === 'skipped') return '';
  const seconds = estimateStepSeconds(id, step);
  return seconds > 0 ? `预计 ${formatEta(seconds)}` : '';
}

export function createAnalysisProgress(container) {
  let rows = null;

  function mount() {
    container.innerHTML = STEP_IDS.map(
      (id) => `
      <li class="job-step" data-step="${id}" data-status="pending">
        <span class="job-dot" aria-hidden="true"></span>
        <span class="job-name">${STEP_LABELS[id]}</span>
        <span class="job-count" data-role="count"></span>
        <span class="job-eta" data-role="eta"></span>
        <span class="job-bar" aria-hidden="true"><i data-role="bar"></i></span>
        <span class="job-detail" data-role="detail"></span>
      </li>`
    ).join('');

    rows = {};
    for (const id of STEP_IDS) {
      const row = container.querySelector(`[data-step="${id}"]`);
      if (!row) continue;
      rows[id] = {
        row,
        count: row.querySelector('[data-role="count"]'),
        eta: row.querySelector('[data-role="eta"]'),
        bar: row.querySelector('[data-role="bar"]'),
        detail: row.querySelector('[data-role="detail"]')
      };
    }
  }

  function update(job) {
    if (!job || !job.steps) return;
    if (!rows) mount();

    for (const id of STEP_IDS) {
      const step = job.steps[id];
      const target = rows[id];
      if (!step || !target) continue;

      target.row.dataset.status = step.status || 'pending';
      target.count.textContent = countText(step);
      target.eta.textContent = etaText(id, step);
      target.bar.style.width = `${stepPercent(step)}%`;
      target.detail.textContent = step.status === 'failed' ? step.error || step.detail || '' : step.detail || '';
    }

    container.dataset.status = job.status || 'running';
  }

  function reset() {
    rows = null;
    container.innerHTML = '';
    delete container.dataset.status;
  }

  return { update, reset };
}