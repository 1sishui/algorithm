/**
 * 六维特征 v0：从「运行记录」推算行为指标
 *
 * 重要声明：这六个分数是**行为代理指标**，不是“理解度真值”。
 * 它们的价值在于——全部由真实运行数据算出，公式公开、可复现、可讨论，
 * 而不是像早期版本那样用 id 哈希随机生成。
 *
 * 每个维度都返回 { value, detail }：
 *   value  0~100，数据不足时为 null
 *   detail 一句话说明这个分数是怎么来的（答辩时可以直接念）
 */
export const DIMENSIONS = [
  { key: 'fix', name: '错误修正', desc: '出错之后有没有改对' },
  { key: 'transfer', name: '题型迁移', desc: '同类算法练得够不够广' },
  { key: 'diversity', name: '思路多样性', desc: '用过的算法是否分散' },
  { key: 'attempt', name: '尝试模式', desc: '一次练习里迭代了几轮' },
  { key: 'coverage', name: '覆盖均衡', desc: '各大类是否都练到' },
  { key: 'slope', name: '难度爬升', desc: '输入规模是否在变大' }
];

const SESSION_GAP_MS = 30 * 60 * 1000;

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function entropy(counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  return counts.reduce((sum, count) => {
    if (count === 0) return sum;
    const p = count / total;
    return sum - p * Math.log(p);
  }, 0);
}

function median(nums) {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 按 30 分钟无操作切分会话 */
export function splitSessions(runs) {
  const sorted = [...runs].sort((a, b) => new Date(a.at) - new Date(b.at));
  const sessions = [];
  let last = null;

  for (const run of sorted) {
    const time = new Date(run.at).getTime();
    if (!last || time - last > SESSION_GAP_MS) sessions.push([]);
    sessions[sessions.length - 1].push(run);
    last = time;
  }
  return sessions;
}

/**
 * @param {Array} runs 运行记录
 * @param {Array} catalog 可选：算法清单 [{name, category}]，用来算“同类覆盖度”
 */
export function computeFeatures(runs, catalog = []) {
  const list = (runs || []).filter((run) => run && run.at);
  const sample = list.length;

  const dims = {
    fix: { value: null, detail: '还没有运行记录' },
    transfer: { value: null, detail: '还没有运行记录' },
    diversity: { value: null, detail: '还没有运行记录' },
    attempt: { value: null, detail: '还没有运行记录' },
    coverage: { value: null, detail: '还没有运行记录' },
    slope: { value: null, detail: '还没有运行记录' }
  };

  if (sample === 0) {
    return { dims, sample: 0, confidence: 0, sessions: 0 };
  }

  const ordered = [...list].sort((a, b) => new Date(a.at) - new Date(b.at));
  const sessions = splitSessions(ordered);

  /* ---- 1. 错误修正：出错之后，同一算法是否被改对 ---- */
  {
    let errors = 0;
    let fixed = 0;
    for (let i = 0; i < ordered.length; i++) {
      if (!ordered[i].error) continue;
      errors += 1;
      const next = ordered.slice(i + 1).find((run) => run.algorithm === ordered[i].algorithm);
      if (next && !next.error) fixed += 1;
    }

    if (errors === 0) {
      dims.fix = { value: 70, detail: `${sample} 次运行没有报错，暂按 70 分计（无法观察修正行为）` };
    } else {
      const rate = fixed / errors;
      dims.fix = {
        value: Math.round(clamp(30 + 60 * rate)),
        detail: `出错 ${errors} 次，其中 ${fixed} 次在后续运行中改对（修正率 ${(rate * 100).toFixed(0)}%）`
      };
    }
  }

  /* ---- 2. 题型迁移：同类算法里练过多少种 ---- */
  {
    const byCategory = new Map();
    for (const run of ordered) {
      const cat = run.category || '未分类';
      if (!byCategory.has(cat)) byCategory.set(cat, new Set());
      byCategory.get(cat).add(run.algorithm);
    }

    const available = new Map();
    for (const algo of catalog) {
      const cat = algo.category || '未分类';
      available.set(cat, (available.get(cat) || 0) + 1);
    }

    let sum = 0;
    let count = 0;
    for (const [cat, used] of byCategory) {
      const total = available.get(cat) || used.size;
      sum += used.size / Math.max(1, total);
      count += 1;
    }
    const coverage = count ? sum / count : 0;
    const okRuns = ordered.filter((run) => !run.error).length;
    const success = okRuns / sample;

    dims.transfer = {
      value: Math.round(clamp(100 * coverage * (0.6 + 0.4 * success))),
      detail: `涉及 ${count} 个类别，同类算法平均覆盖 ${(coverage * 100).toFixed(0)}%，成功率 ${(success * 100).toFixed(0)}%`
    };
  }

  /* ---- 3. 思路多样性：用过的算法分布有多分散 ---- */
  {
    const usage = new Map();
    for (const run of ordered) usage.set(run.algorithm, (usage.get(run.algorithm) || 0) + 1);

    const h = entropy([...usage.values()]);
    const maxH = Math.log(Math.max(2, usage.size));
    const spread = maxH > 0 ? h / maxH : 0;

    dims.diversity = {
      value: Math.round(clamp(100 * spread)),
      detail: `用过 ${usage.size} 种算法，分布${spread > 0.8 ? '较均匀' : spread > 0.5 ? '一般' : '集中在少数几种'}`
    };
  }

  /* ---- 4. 尝试模式：一次练习里迭代了几轮 ---- */
  {
    const perSession = sessions.map((session) => session.length);
    const avg = perSession.reduce((a, b) => a + b, 0) / perSession.length;

    dims.attempt = {
      value: Math.round(clamp((avg / 6) * 100)),
      detail: `共 ${sessions.length} 次练习，平均每次 ${avg.toFixed(1)} 轮运行`
    };
  }

  /* ---- 5. 覆盖均衡：各大类的练习量是否平均 ---- */
  {
    const counts = new Map();
    for (const run of ordered) {
      const cat = run.category || '未分类';
      counts.set(cat, (counts.get(cat) || 0) + 1);
    }
    const values = [...counts.values()];
    const h = entropy(values);
    const maxH = Math.log(Math.max(2, values.length));

    dims.coverage = {
      value: Math.round(clamp(100 * (maxH > 0 ? h / maxH : 0))),
      detail: `练过 ${values.length} 个类别，练习量${h / maxH > 0.8 ? '比较均衡' : '偏科明显'}`
    };
  }

  /* ---- 6. 难度爬升：输入规模随时间的走向 ---- */
  {
    const sizes = ordered.map((run) => Number(run.size) || 0).filter((n) => n > 0);
    if (sizes.length < 3) {
      dims.slope = { value: null, detail: '至少需要 3 次有规模的运行才能看趋势' };
    } else {
      const n = sizes.length;
      const meanX = (n - 1) / 2;
      const meanY = sizes.reduce((a, b) => a + b, 0) / n;
      let num = 0;
      let den = 0;
      sizes.forEach((y, x) => {
        num += (x - meanX) * (y - meanY);
        den += (x - meanX) ** 2;
      });
      const slope = den === 0 ? 0 : num / den;
      const relative = meanY === 0 ? 0 : slope / meanY;

      dims.slope = {
        value: Math.round(clamp(50 + 250 * relative)),
        detail: `平均规模 ${meanY.toFixed(1)}，每轮变化 ${slope >= 0 ? '+' : ''}${slope.toFixed(2)}`
      };
    }
  }

  return {
    dims,
    sample,
    sessions: sessions.length,
    confidence: Math.min(1, sample / 20)
  };
}