// Supabase Edge Function：大模型诊断代理（生产版）
//
// 作用与 server/llm_proxy.py 完全一致，区别是跑在云端：
//   - key 存在 Supabase Secrets 里，不进代码仓库
//   - 前端只调用本函数，永远拿不到 key
//
// 部署（在项目根目录执行，需先装 Supabase CLI 并登录）：
//   supabase functions deploy diagnose --no-verify-jwt
//   supabase secrets set LLM_API_KEY=sk-xxx LLM_BASE_URL=https://api.deepseek.com/v1 LLM_MODEL=deepseek-chat
//
// 部署后把前端的 ENDPOINT 改成：
//   https://<你的项目>.supabase.co/functions/v1/diagnose

const SYSTEM_PROMPT = `你是一名算法学习教练，负责诊断学生代码中的错误，并引导学生自己发现问题。

硬性规则（违反任何一条都视为失败）：
1. 只输出一个 JSON 对象。不要解释、不要 Markdown 代码围栏、不要多余文字。
2. 绝对不要输出完整函数、完整解法或可直接提交的代码。hint 里最多出现一行代码片段。
3. question 必须是苏格拉底式提问：引导学生自己观察和推理，不能直接给出答案。
4. 不要评判学生，不要写“你应该”“你不能”这类说教。
5. errorType 只能取以下之一：boundary（边界/越界）、complexity（复杂度）、recursion（递归/终止条件）、logic（逻辑结构）、type（类型/溢出）、none（未发现明确错误）。
6. line 是错误所在行号，从 1 开始；无法确定时给 null。
7. confidence 用 0~1 的小数，不确定就给低值。
8. 分类口径（三类最容易混，按下面判）：
   - boundary：位置问题。例如 i <= n 导致 a[n] 越界、空数组取 a[0]、s[s.length()]。
   - type：数值/类型问题。例如 (l + r) / 2 在 l、r 很大时整型溢出、int 存不下结果、无符号数相减。
   - logic：流程问题。例如循环变量更新后区间不再缩小（l = mid）导致死循环、比较方向写反、变量未初始化。
   只有在确实找不到缺陷时才判 none；不要因为“还有别的边界情况没处理”就判 none。

输出 JSON 的字段：
{
  "errorType": "boundary",
  "label": "边界条件错误",
  "line": 3,
  "evidence": "一句话说明依据，指出具体变量或条件",
  "question": "一个开放问题，引导学生自己发现",
  "hint": "一句话提示，不含完整代码",
  "confidence": 0.8
}`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED = new Set(["boundary", "complexity", "recursion", "logic", "type", "none"]);
const LABELS: Record<string, string> = {
  boundary: "边界条件错误",
  complexity: "复杂度问题",
  recursion: "递归/终止条件问题",
  logic: "逻辑结构问题",
  type: "类型/溢出问题",
  none: "未发现明确错误",
};

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

function buildMessages(code: string, algorithm?: string, language?: string, problem?: string) {
  const parts: string[] = [];
  if (algorithm) parts.push(`算法/知识点：${algorithm}`);
  if (language) parts.push(`语言：${language}`);
  if (problem) parts.push(`题目描述：${problem}`);
  parts.push("学生代码（行号仅供参考，不要复述整段代码）：");
  parts.push(code.split("\n").map((line, i) => `${String(i + 1).padStart(3)}| ${line}`).join("\n"));
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: parts.join("\n") },
  ];
}

function parseJsonLoose(text: string) {
  const cleaned = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

const CODE_LIKE = /(```|;\s*$|\breturn\b.*[;{}]|\bfor\s*\(|\bwhile\s*\()/m;

function sanitize(raw: any) {
  if (!raw || typeof raw !== "object") return null;

  let errorType = String(raw.errorType || "").trim().toLowerCase();
  if (!ALLOWED.has(errorType)) errorType = "logic";

  const text = (v: unknown, limit = 300) => String(v ?? "").trim().slice(0, limit);
  let hint = text(raw.hint, 200);
  const question = text(raw.question, 300) || "先说说这段代码每一步在做什么？它第一次出错会是在什么输入下？";
  const evidence = text(raw.evidence) || "模型没有给出具体依据";

  const leak = CODE_LIKE.test(hint) || hint.split("\n").length > 1;
  if (leak) hint = "这段提示里可能包含完整代码，已隐藏。请先自己走一遍边界情况。";

  let line: number | null = Number.isFinite(Number(raw.line)) ? Number(raw.line) : null;
  if (line !== null && line <= 0) line = null;

  let confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence)) confidence = 0.6;
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    errorType,
    label: text(raw.label, 40) || LABELS[errorType],
    line,
    evidence,
    question,
    hint,
    confidence,
    forbidCompleteSolution: true,
    codeLeakRemoved: leak,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { ok: false, reason: "method_not_allowed" });

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json(400, { ok: false, reason: "bad_json" });
  }

  const code = String(payload?.code ?? "").slice(0, 8000);
  if (code.trim().length < 5) return json(400, { ok: false, reason: "empty_code" });

  const apiKey = Deno.env.get("LLM_API_KEY") ?? "";
  const baseUrl = (Deno.env.get("LLM_BASE_URL") ?? "https://api.deepseek.com/v1").replace(/\/+$/, "");
  const model = Deno.env.get("LLM_MODEL") ?? "deepseek-chat";

  if (!apiKey) return json(200, { ok: false, reason: "no_api_key" });

  const started = Date.now();

  try {
    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: buildMessages(code, payload?.algorithm, payload?.language, payload?.problem),
        temperature: 0.2,
        max_tokens: 600,
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!upstream.ok) {
      return json(502, { ok: false, reason: "upstream_error", message: `模型接口返回 ${upstream.status}` });
    }

    const data = await upstream.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    const result = sanitize(parseJsonLoose(content));
    if (!result) return json(502, { ok: false, reason: "bad_output" });

    return json(200, {
      ok: true,
      result,
      meta: { model, latency_ms: Date.now() - started, cached: false },
    });
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "TimeoutError";
    return json(502, {
      ok: false,
      reason: isTimeout ? "timeout" : "network_error",
      message: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    });
  }
});