/**
 * 错误诊断（规则版）
 *
 * 这是大模型诊断的“接口占位实现”：输入代码，输出固定结构的诊断结果。
 * 后面把 diagnose() 换成调用 Edge Function（服务端拼提示词、调模型）即可，
 * UI 一行都不用改 —— 这就是先定接口的好处。
 *
 * 输出结构与将来大模型返回的 JSON 保持一致：
 * { errorType, label, evidence, line, question, hint, confidence, forbidCompleteSolution }
 */

const RULES = [
  {
    id: 'out-of-range',
    label: '边界条件错误',
    evidence: '循环条件里用了 `<=` 搭配数组长度',
    question: '如果数组长度是 5，循环变量最大会取到几？最后一次访问的下标存在吗？',
    hint: '把 `<=` 改成 `<`，或者让上界减一。',
    locate: (code) => code.search(/for\s*\([^;]*;[^;]*<=\s*[\w.]+/)
  },
  {
    id: 'mid-overflow',
    label: '整数溢出 / 死循环风险',
    evidence: '中点写成 `(l + r) / 2`',
    question: '当 l 和 r 都很大时，l + r 会不会超出整型范围？换成什么写法可以避免？',
    hint: '用 `l + (r - l) / 2`。',
    locate: (code) => code.search(/\(\s*\w+\s*\+\s*\w+\s*\)\s*\/\s*2/)
  },
  {
    id: 'no-base-case',
    label: '递归缺少终止条件',
    evidence: '函数里调用了自身，但没有发现 if + return 的终止分支',
    question: '递归什么时候停下来？如果没有这个条件，函数会调用多少次？',
    hint: '先写终止条件，再写递归调用。',
    locate: (code) => {
      // 支持 C/Java 风格和 JS 风格两种函数定义
      const def = /(?:[A-Za-z_]\w*\s+)+([A-Za-z_]\w*)\s*\([^)]*\)\s*\{/.exec(code);
      if (!def) return -1;
      const selfCall = new RegExp('\\b' + def[1] + '\\s*\\(');
      const rest = code.replace(def[0], ''); // 去掉定义本身，避免自己匹配自己
      if (!selfCall.test(rest)) return -1;
      const hasBase = /if\s*\([^)]*\)\s*\{?\s*return/.test(code);
      return hasBase ? -1 : def.index;
    }
  },
  {
    id: 'empty-input',
    label: '空输入未处理',
    evidence: '直接访问了 `[0]`，但没有先判断数组是否为空',
    question: '如果输入是空数组，`arr[0]` 是什么？后面的代码还能正常跑吗？',
    hint: '在函数开头加一句空数组判断。',
    locate: (code) => {
      const touchesFirst = /\[\s*0\s*\]/.test(code);
      const guards = /length\s*===?\s*0|length\s*<\s*1|!\s*\w+\.length/.test(code);
      return touchesFirst && !guards ? 0 : -1;
    }
  },
  {
    id: 'wrong-compare',
    label: '比较方向可能写反',
    evidence: '比较之后直接 continue，可能跳过了本该处理的情况',
    question: '你要的是升序还是降序？这个比较符对应的方向对吗？',
    hint: '拿两个数在纸上摆一下，再核对一次比较符。',
    locate: (code) => code.search(/if\s*\([^)]*>\s*[^)]*\)\s*\{?\s*continue/)
  }
];

const FALLBACK = {
  id: 'logic',
  label: '逻辑结构待确认',
  evidence: '没有命中已知的错误模式',
  question: '先别改代码：用一句话说出这段代码每一步在干什么，再说它什么时候会出错。',
  hint: '用一组最小的输入（比如 3 个数）手动走一遍。'
};

function lineOf(code, index) {
  if (index < 0) return null;
  return code.slice(0, index).split('\n').length;
}

export function diagnose(code) {
  const text = String(code || '').trim();

  if (text.length < 5) {
    return {
      errorType: 'unknown',
      label: '代码太短',
      evidence: '还没有可以分析的内容',
      question: '把完整的函数粘进来，包括循环和返回语句。',
      hint: '',
      line: null,
      confidence: 0,
      forbidCompleteSolution: true
    };
  }

  for (const rule of RULES) {
    const index = rule.locate(text);
    if (index >= 0) {
      return {
        errorType: rule.id,
        label: rule.label,
        evidence: rule.evidence,
        line: lineOf(text, index),
        question: rule.question,
        hint: rule.hint,
        confidence: 0.7,
        forbidCompleteSolution: true
      };
    }
  }

  return {
    errorType: FALLBACK.id,
    label: FALLBACK.label,
    evidence: FALLBACK.evidence,
    line: null,
    question: FALLBACK.question,
    hint: FALLBACK.hint,
    confidence: 0.35,
    forbidCompleteSolution: true
  };
}