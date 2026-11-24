/**
 * 六维面板
 *
 * 只负责把 computeFeatures 算出来的数字画出来；公式不在这里，在 assessment/features.js。
 * 数值为空时显示「—」，表示数据不足，而不是给个假分数。
 */
import { DIMENSIONS } from '../assessment/features.js';

export function createMastery(container) {
  container.innerHTML = DIMENSIONS.map(
    (dim) => `
    <div class="mastery-row" title="${dim.desc}" data-row="${dim.key}">
      <span class="name">${dim.name}</span>
      <span class="track"><span class="fill" data-key="${dim.key}" style="width:0%"></span></span>
      <span class="val" data-val="${dim.key}">—</span>
    </div>`
  ).join('');

  const rows = {};
  DIMENSIONS.forEach((dim) => {
    rows[dim.key] = {
      row: container.querySelector(`[data-row="${dim.key}"]`),
      fill: container.querySelector(`[data-key="${dim.key}"]`),
      val: container.querySelector(`[data-val="${dim.key}"]`)
    };
  });

  function render(dims) {
    DIMENSIONS.forEach((dim) => {
      const item = dims ? dims[dim.key] : null;
      const value = item && item.value != null ? Math.round(item.value) : null;
      const target = rows[dim.key];

      target.fill.style.width = value == null ? '0%' : `${value}%`;
      target.val.textContent = value == null ? '—' : String(value);
      target.row.title = (item && item.detail) || dim.desc;
    });
  }

  return { render };
}