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

  /* 1. 错误修正：从“第一次提交”到“通过”用了几次，指数衰减，永远落在 0–100 */
  {
    const scores = problems.map((item) => {
      if (!item.accepted) return 0; // 一直没做出来，视为没有收敛
      // 1 次通过 = 100；2 次 ≈ 85；5 次 ≈ 52；10 次 ≈ 23；不会出现负数
      return 100 * Math.pow(0.85, item.attempts - 1);
    });
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const neverSolved = problems.length - solved.length;
    const solvedAvg =
      solved.length > 0
        ? solved.reduce((sum, item) => sum + 100 * Math.pow(0.85, item.attempts - 1), 0) / solved.length
        : 0;

    dims.fix = {
      value: Math.round(clamp(avg)),
      detail:
        `洛谷：共 ${problems.length} 题，通过 ${solved.length} 题` +
        (neverSolved ? `，未通过 ${neverSolved} 题（记 0 分）` : '') +
        `；通过题平均 ${solvedAvg.toFixed(0)} 分（按首次通过前的提交次数衰减）`
    };
  }

  /* 2. 题型迁移：通过率 —— 能把多少“做过的题”真正做出来 */
  {
    const solveRate = problems.length ? solved.length / problems.length : 0;

    dims.transfer = {
      value: Math.round(clamp(100 * solveRate)),
      detail: `洛谷：做过 ${problems.length} 题，通过 ${solved.length} 题，通过率 ${(solveRate * 100).toFixed(0)}%`
    };
  }

  /* 3. 思路多样性：覆盖了几个难度层（8 层）——竞赛选手基本只用 C++，语言不计入 */
  {
    const usedLevels = levels.filter((count) => count > 0).length;

    dims.diversity = {
      value: Math.round(clamp((usedLevels / 8) * 100)),
      detail: `洛谷：覆盖 ${usedLevels} / 8 个难度层`
    };
  }

  /* 4. 尝试模式：每题提交次数的中位数 —— 2–3 次是健康区间 */
  {
    const attempts = problems.map((item) => item.attempts);
    const mid = median(attempts);
    let value;
    if (mid <= 1) value = 45;
    else if (mid === 2) value = 85;
    else if (mid === 3) value = 100;
    else value = Math.max(20, 100 - 12 * (mid - 3));

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