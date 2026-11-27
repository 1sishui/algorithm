/**
 * 算法诊断与刷题推荐
 *
 * 同步做题情况之后，直接告诉用户：
 *   - 哪些大类强、哪些弱（具体到每个大类，附做过/通过/平均提交）
 *   - 薄弱的几个大类，去洛谷找难度合适的题（排除已经做过的）
 */
import { categoryOfTag } from '../knowledge/tagCategories.js';
import { recommendProblems } from '../import/luoguClient.js';
import { VERDICT_CONFIG } from '../config.js';

/**
 * 合并默认阈值与调用方覆盖项。
 *
 * options 存在的意义：让「改阈值 → 结果变化」这件事能被测试证明，
 * 而不是只能手动改 config.js 再刷新页面。不传 options 时行为与抽取前完全一致。
 */
function resolveConfig(options = {}) {
  return { ...VERDICT_CONFIG, ...options };
}

/** 把每道题的标签归并成大类，并统计每个大类的表现 */
export function buildCategoryStats(submissions, pidTags, tagEntry, options = {}) {
  const config = resolveConfig(options);
  const problemInfo = new Map();
  for (const record of submissions) {
    if (!record.pid) continue;
    const entry = problemInfo.get(record.pid) || { solved: false, difficulty: 0, attempts: 0 };
    entry.attempts += 1;
    if (record.accepted) entry.solved = true;
    if (!entry.difficulty && record.difficulty) entry.difficulty = record.difficulty;
    problemInfo.set(record.pid, entry);
  }

  const byCategory = new Map();
  for (const [pid, info] of problemInfo) {
    const tags = tagEntry(pid).tags;
    if (!tags.length) continue;

    const categories = [...new Set(tags.map(categoryOfTag))];
    for (const category of categories) {
      if (!byCategory.has(category)) {
        byCategory.set(category, {
          category,
          problems: 0,
          solved: 0,
          attempts: 0,
          difficultySum: 0,
          tagCount: new Map()
        });
      }
      const entry = byCategory.get(category);
      entry.problems += 1;
      entry.attempts += info.attempts;
      entry.difficultySum += info.difficulty || 0;
      if (info.solved) entry.solved += 1;
      for (const tag of tags) {
        if (categoryOfTag(tag) === category) {
          entry.tagCount.set(tag, (entry.tagCount.get(tag) || 0) + 1);
        }
      }
    }
  }

  return [...byCategory.values()]
    .map((entry) => {
      const rate = entry.problems ? entry.solved / entry.problems : 0;
      const avgAttempts = entry.problems ? entry.attempts / entry.problems : 0;
      const avgDifficulty = entry.problems ? entry.difficultySum / entry.problems : 0;

      // 严进宽出：强要求两个条件同时满足，弱只需任一条件成立（详见 config.js 的注释）
      let level = '中';
      if (rate >= config.strongRate && avgAttempts <= config.strongMaxAttempts) level = '强';
      else if (rate < config.weakRate || avgAttempts >= config.weakMinAttempts) level = '弱';

      const topTags = [...entry.tagCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([tag]) => tag);

      return {
        category: entry.category,
        problems: entry.problems,
        solved: entry.solved,
        rate,
        avgAttempts,
        avgDifficulty,
        topTags,
        level
      };
    })
    .sort((a, b) => a.rate - b.rate || b.avgAttempts - a.avgAttempts);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

/**
 * 渲染「算法诊断」区块到容器末尾
 * @param {HTMLElement} container
 * @param {Array} stats buildCategoryStats 的结果
 * @param {Array} submissions 用来排除已做过的题
 */
export function renderVerdict(container, stats, submissions, options = {}) {
  if (!stats.length) return;

  const config = resolveConfig(options);
  const weak = stats.filter((item) => item.level === '弱').slice(0, 4);
  const strong = stats.filter((item) => item.level === '强').slice(0, 4);

  const section = document.createElement('div');
  section.className = 'verdict';

  const rows = stats
    .slice(0, config.maxCategories)
    .map(
      (item) => `
      <div class="verdict-row level-${item.level}">
        <span class="v-name">${escapeHtml(item.category)}</span>
        <span class="v-tag">${item.level}</span>
        <span class="v-num">做过 ${item.problems} · 通过 ${item.solved} · 通过率 ${(item.rate * 100).toFixed(0)}% · 均提交 ${item.avgAttempts.toFixed(1)}</span>
      </div>`
    )
    .join('');

  section.innerHTML = `
    <div class="luogu-subtitle">算法诊断（共 ${stats.length} 类）</div>
    <div class="verdict-list">${rows}</div>
    ${
      weak.length
        ? `<div class="verdict-actions">
             <button id="btn-recommend" class="primary">给薄弱算法推荐题目</button>
             <span id="recommend-status" class="muted"></span>
           </div>
           <div id="recommend-list" class="recommend-list"></div>`
        : `<div class="verdict-actions"><span class="muted">暂时没有明显薄弱的算法，保持这个节奏。</span></div>`
    }
  `;

  container.appendChild(section);

  const button = section.querySelector('#btn-recommend');
  if (!button) return;

  const statusEl = section.querySelector('#recommend-status');
  const listEl = section.querySelector('#recommend-list');

  button.addEventListener('click', async () => {
    button.disabled = true;
    statusEl.textContent = '正在洛谷找题…';
    statusEl.className = 'muted';

    const exclude = [...new Set(submissions.map((record) => record.pid).filter(Boolean))];
    const picked = [];

    for (const item of weak.slice(0, 3)) {
      const difficulty = Math.max(2, Math.min(6, Math.round(item.avgDifficulty) + 1));
      const result = await recommendProblems(item.topTags, difficulty, exclude);
      if (result && result.ok && result.problems) {
        for (const problem of result.problems) {
          if (picked.some((existing) => existing.pid === problem.pid)) continue;
          picked.push({ ...problem, category: item.category });
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    button.disabled = false;

    if (picked.length === 0) {
      statusEl.textContent = '没找到合适的题，稍后再试';
      statusEl.className = 'bad';
      return;
    }

    statusEl.textContent = `找到 ${picked.length} 道`;
    statusEl.className = 'ok';

    listEl.innerHTML = picked
      .slice(0, 8)
      .map(
        (problem) => `
        <div class="rec-item">
          <a class="rec-link" href="https://www.luogu.com.cn/problem/${encodeURIComponent(problem.pid)}" target="_blank" rel="noreferrer">
            ${escapeHtml(problem.pid)} ${escapeHtml(problem.name || '')}
          </a>
          <span class="rec-meta">${escapeHtml(problem.category)} · 难度 ${problem.difficulty ?? '?'} · ${escapeHtml(problem.tag || '')}</span>
        </div>`
      )
      .join('');
  });
}