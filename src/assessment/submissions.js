/**
 * 由洛谷做题记录推算六维（数据版）
 *
 * 与 features.js（由本机运行记录推算）是两套口径：
 *   - 运行记录看的是「在可视化里练算法」的行为
 *   - 洛谷记录看的是「真实做题」的行为
 * 有洛谷数据时优先用它，因为它更接近申请书里说的“提交记录”。
 *
 * 同样声明：这些是行为代理指标，不是理解度真值。
 */
import { difficultyLabel } from '../import/luogu.js';

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function entropy(counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  return counts.reduce((sum, count) => {
    if (count <= 0) return sum;
    const p = count / total;
    return sum - p * Math.log(p);
  }, 0);
}

function median(nums) {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 按题目聚合：每题提交了几次、是否通过、难度多少 */
export function groupByProblem(records) {
  const map = new Map();

  for (const record of records || []) {
    const key = record.pid || record.title || record.id;
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        pid: key,
        title: record.title || key,
        difficulty: Number(record.difficulty) || 0,
        attempts: 0,
        accepted: false,
        firstAcceptedAt: null,
        lastAt: null
      });
    }
    const item = map.get(key);
    item.attempts += 1;
    if (!item.difficulty && record.difficulty) item.difficulty = record.difficulty;
    if (record.accepted && !item.accepted) {
      item.accepted = true;
      item.firstAcceptedAt = record.submittedAt;
    }
    if (record.submittedAt) item.lastAt = record.submittedAt;
  }

  return [...map.values()];
}

export function computeSubmissionFeatures(records) {
  const list = (records || []).filter((record) => record && (record.pid || record.title));
  if (list.length === 0) return null;

  const problems = groupByProblem(list);
  const solved = problems.filter((item) => item.accepted);
  const levels = new Array(8).fill(0);
  for (const item of problems) {
    const level = Math.max(0, Math.min(7, Number(item.difficulty) || 0));
    levels[level] += 1;
  }

  const dims = {};

  /* 1. 错误修正：每题通过之前提交了几次 */
  {
    const scores = problems.map((item) => {
      if (!item.accepted) return 15;
      return clamp(100 - 18 * (item.attempts - 1), 20, 100);
    });
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const neverSolved = problems.length - solved.length;

    dims.fix = {
      value: Math.round(avg),
      detail: `洛谷：共 ${problems.length} 题，通过 ${solved.length} 题${neverSolved ? `，未通过 ${neverSolved} 题` : ''}；按“首次通过前的提交次数”折算`
    };
  }

  /* 2. 题型迁移：解决率 × 难度覆盖 */
  {
    const solveRate = problems.length ? solved.length / problems.length : 0;
    const usedLevels = levels.filter((count) => count > 0).length;
    const spread = usedLevels / 8;

    dims.transfer = {
      value: Math.round(clamp(100 * solveRate * (0.6 + 0.4 * spread))),
      detail: `洛谷：解决率 ${(solveRate * 100).toFixed(0)}%，覆盖 ${usedLevels} 个难度层`
    };
  }

  /* 3. 思路多样性：难度层数 + 语言种类 */
  {
    const usedLevels = levels.filter((count) => count > 0).length;
    const languages = new Set(list.map((r) => r.language).filter(Boolean)).size || 1;
    const value = 100 * (0.7 * (usedLevels / 8) + 0.3 * Math.min(1, languages / 3));

    dims.diversity = {
      value: Math.round(clamp(value)),
      detail: `洛谷：覆盖 ${usedLevels} 个难度层、${languages} 种语言`
    };
  }

  /* 4. 尝试模式：每题提交次数的中位数（1 次像抄模板，2–4 次是正常迭代） */
  {
    const attempts = problems.map((item) => item.attempts);
    const mid = median(attempts);
    let value;
    if (mid <= 3) value = 45 + 25 * (mid - 1);
    else value = Math.max(50, 95 - 10 * (mid - 3));

    dims.attempt = {
      value: Math.round(clamp(value)),
      detail: `洛谷：每题平均提交 ${(list.length / problems.length).toFixed(1)} 次，中位数 ${mid} 次`
    };
  }

  /* 5. 覆盖均衡：练习量在难度层上的分布熵 */
  {
    const h = entropy(levels);
    const maxH = Math.log(8);
    dims.coverage = {
      value: Math.round(clamp((h / maxH) * 100)),
      detail: `洛谷：练过 ${levels.filter((c) => c > 0).length} 个难度层，分布${h / maxH > 0.7 ? '较均衡' : '集中在少数几层'}`
    };
  }

  /* 6. 难度爬升：后三分之一与前三分之一的平均难度差 */
  {
    const ordered = [...problems].sort(
      (a, b) => new Date(a.firstAcceptedAt || a.lastAt || 0) - new Date(b.firstAcceptedAt || b.lastAt || 0)
    );
    if (ordered.length < 3) {
      dims.slope = { value: null, detail: '洛谷：至少需要 3 道题的记录才能看趋势' };
    } else {
      const third = Math.max(1, Math.floor(ordered.length / 3));
      const avg = (arr) => arr.reduce((sum, item) => sum + (item.difficulty || 0), 0) / arr.length;
      const early = avg(ordered.slice(0, third));
      const late = avg(ordered.slice(-third));
      const delta = late - early;

      dims.slope = {
        value: Math.round(clamp(50 + 20 * delta)),
        detail: `洛谷：早期平均难度 ${early.toFixed(1)}（${difficultyLabel(Math.round(early))}）→ 近期 ${late.toFixed(1)}`
      };
    }
  }

  return { dims, sample: list.length, problems: problems.length, source: '洛谷' };
}