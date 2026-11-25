/**
 * 错误修正质量分析：不只看“提交了几次”，还看“每次改了什么”
 *
 * 需要每次提交的代码。有代码时：
 *   - 逐次比较相邻两次提交（行级相似度）
 *   - 区分「微调 / 局部修改 / 大改 / 重写」
 *   - 用“时间间隔极短 + 整段重写”识别疑似粘贴题解
 *   - 用“小步修改占比”判断是否改到了点上
 *
 * 没有代码时退回只看提交次数的口径（见 submissions.js）。
 *
 * 申明：这些都是行为推断，不是“他一定抄了/一定懂了”的结论。
 */
import { compareCode } from './diff.js';

const SUSPECT_GAP_SECONDS = 90;

/**
 * @param {Array<{code?:string, accepted:boolean, status?:string, submittedAt?:string}>} attempts 按时间升序
 */
export function analyzeCorrection(attempts) {
  const list = Array.isArray(attempts) ? attempts.filter(Boolean) : [];
  if (list.length === 0) return null;

  const accepted = list[list.length - 1].accepted === true;
  const baseScore = accepted ? 100 * Math.pow(0.85, list.length - 1) : 0;

  const transitions = [];
  for (let i = 1; i < list.length; i += 1) {
    const before = list[i - 1];
    const after = list[i];
    if (!before.code || !after.code) continue;

    const diff = compareCode(before.code, after.code);
    const gapSeconds =
      before.submittedAt && after.submittedAt
        ? Math.max(0, (new Date(after.submittedAt) - new Date(before.submittedAt)) / 1000)
        : null;

    transitions.push({
      ...diff,
      gapSeconds,
      suspectedPaste:
        gapSeconds !== null && gapSeconds <= SUSPECT_GAP_SECONDS && diff.level === '重写'
    });
  }

  const withCode = transitions.length > 0;
  const smallEdits = transitions.filter((t) => t.similarity >= 0.65).length;
  const rewrites = transitions.filter((t) => t.level === '重写').length;
  const suspected = transitions.filter((t) => t.suspectedPaste).length;

  const targetedRatio = withCode ? smallEdits / transitions.length : null;
  const avgSimilarity = withCode
    ? transitions.reduce((sum, t) => sum + t.similarity, 0) / transitions.length
    : null;

  // 有代码时才做质量加权；没代码就是纯次数口径
  let score = baseScore;
  if (withCode) {
    const quality = 0.6 + 0.4 * targetedRatio; // 小步修改越多，说明越接近“找到问题再改”
    const penalty = suspected > 0 ? 0.7 : 1; // 疑似整段粘贴，打折
    score = baseScore * quality * penalty;
  }

  return {
    score: Math.round(Math.max(0, Math.min(100, score))),
    attempts: list.length,
    accepted,
    withCode,
    transitions: transitions.length,
    smallEdits,
    rewrites,
    suspected,
    targetedRatio,
    avgSimilarity,
    detail: describe({ list, withCode, transitions: transitions.length, smallEdits, rewrites, suspected, targetedRatio, avgSimilarity })
  };
}

function describe({ list, withCode, transitions, smallEdits, rewrites, suspected, targetedRatio, avgSimilarity }) {
  const head = `${list.length} 次提交${list[list.length - 1].accepted ? '，最后一次通过' : '，最终没通过'}`;

  if (!withCode) {
    return `${head}；没有可比对的代码，按提交次数折算`;
  }

  const parts = [
    head,
    `可比对 ${transitions} 次修改`,
    `小步改 ${smallEdits} 次`,
    rewrites > 0 ? `整段重写 ${rewrites} 次` : null,
    suspected > 0 ? `疑似直接粘贴 ${suspected} 次` : null,
    `平均相似度 ${(avgSimilarity * 100).toFixed(0)}%`,
    `小步修改占比 ${(targetedRatio * 100).toFixed(0)}%`
  ].filter(Boolean);

  return parts.join('；');
}