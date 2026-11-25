/**
 * 代码差异：比较同一道题的两次提交
 *
 * 只做「行为层面」的判断，不评判代码好坏：
 *   - 改了几行、动了哪里
 *   - 是小步修正，还是把逻辑整个换掉
 *   - 和上一次相比相似度多少
 *
 * 用 LCS（最长公共子序列）算行级差异。行数超过上限时退化成“行集合相似度”，
 * 避免 O(n²) 卡死浏览器。
 */
const MAX_LCS_LINES = 260;

/** 归一化一行：去首尾空白、压缩空格，避免格式调整被算成改动 */
function normalize(line) {
  return String(line).replace(/\s+/g, ' ').trim();
}

/**
 * 模板代码行（头文件、using、main 壳、纯括号、return 0）不参与相似度计算。
 * 否则两份完全不同的解法，会因为共享 #include 和 int main() 而显得“改得不多”。
 */
const TRIVIAL = [/^#include/, /^using namespace/, /^int main\s*\(/, /^[{}()\s;]*$/, /^return 0\s*;?$/];

function isTrivial(line) {
  return TRIVIAL.some((pattern) => pattern.test(line));
}

function lcsLength(a, b) {
  const m = a.length;
  const n = b.length;
  let prev = new Array(n + 1).fill(0);
  let curr = new Array(n + 1).fill(0);

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  return prev[n];
}

function setSimilarity(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  let common = 0;
  for (const item of setA) if (setB.has(item)) common += 1;
  return (2 * common) / (setA.size + setB.size);
}

/**
 * @param {string} before 上一次提交的代码
 * @param {string} after  这一次提交的代码
 * @returns {{similarity:number, added:number, removed:number, beforeLines:number, afterLines:number, level:'微调'|'局部修改'|'大改'|'重写'}}
 */
export function compareCode(before, after) {
  const rawA = String(before || '').split('\n').map(normalize).filter(Boolean);
  const rawB = String(after || '').split('\n').map(normalize).filter(Boolean);

  // 先去掉模板行；如果去完没东西了（比如只交了框架），就退回原始行
  const trimmedA = rawA.filter((line) => !isTrivial(line));
  const trimmedB = rawB.filter((line) => !isTrivial(line));
  const a = trimmedA.length >= 2 ? trimmedA : rawA;
  const b = trimmedB.length >= 2 ? trimmedB : rawB;

  if (a.length === 0 || b.length === 0) {
    return {
      similarity: 0,
      added: b.length,
      removed: a.length,
      beforeLines: a.length,
      afterLines: b.length,
      level: '重写'
    };
  }

  let common;
  if (a.length <= MAX_LCS_LINES && b.length <= MAX_LCS_LINES) {
    common = lcsLength(a, b);
  } else {
    common = setSimilarity(a, b) * ((a.length + b.length) / 2);
  }

  const similarity = (2 * common) / (a.length + b.length);
  const added = Math.max(0, b.length - common);
  const removed = Math.max(0, a.length - common);

  let level;
  if (similarity >= 0.9) level = '微调';
  else if (similarity >= 0.65) level = '局部修改';
  else if (similarity >= 0.35) level = '大改';
  else level = '重写';

  return {
    similarity: Number(similarity.toFixed(3)),
    added: Math.round(added),
    removed: Math.round(removed),
    beforeLines: a.length,
    afterLines: b.length,
    level
  };
}