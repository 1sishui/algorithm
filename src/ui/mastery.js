/**
 * 六维理解度面板（演示版）
 *
 * 真实版本中这六个数字来自 src/assessment 的特征计算 + 加权模型，
 * 现在先用示例值把交互跑通，方便后面替换。
 */
export const DIMENSIONS = [
  { key: 'fix', name: '错误修正', desc: '从 WA 到 AC 的提交路径' },
  { key: 'transfer', name: '题型迁移', desc: '结构相似、表述不同的题目表现' },
  { key: 'diversity', name: '思路多样性', desc: '同一知识点下方法的丰富度' },
  { key: 'attempt', name: '尝试模式', desc: '提交间隔与修改幅度' },
  { key: 'coverage', name: '覆盖均衡', desc: '知识点分布是否偏科' },
  { key: 'slope', name: '难度爬升', desc: '难度随时间的上升斜率' }
];

export function createMastery(container) {
  container.innerHTML = DIMENSIONS.map(
    (dim) => `
    <div class="mastery-row" title="${dim.desc}">
      <span class="name">${dim.name}</span>
      <span class="track"><span class="fill" data-key="${dim.key}" style="width:0%"></span></span>
      <span class="val" data-val="${dim.key}">0</span>
    </div>`
  ).join('');

  const fills = {};
  const vals = {};
  DIMENSIONS.forEach((dim) => {
    fills[dim.key] = container.querySelector(`[data-key="${dim.key}"]`);
    vals[dim.key] = container.querySelector(`[data-val="${dim.key}"]`);
  });

  let values = { fix: 52, transfer: 41, diversity: 63, attempt: 47, coverage: 58, slope: 44 };

  function render(next) {
    if (next) values = { ...values, ...next };
    DIMENSIONS.forEach((dim) => {
      const v = Math.round(values[dim.key]);
      fills[dim.key].style.width = `${v}%`;
      vals[dim.key].textContent = v;
    });
  }

  function bump(key, delta) {
    values[key] = Math.max(0, Math.min(100, values[key] + delta));
    render();
  }

  render();
  return { render, bump, get: () => ({ ...values }) };
}