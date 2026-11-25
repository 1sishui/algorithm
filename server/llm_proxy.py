"""
大模型诊断代理（开发版，跑在本机 serve.py 里）

为什么需要代理：
  浏览器直连大模型 API 会把 key 暴露给任何人（F12 就能看到），
  所以 key 只能放在服务端。本文件就是那个“服务端”。

生产环境对应的是 supabase/functions/diagnose/index.ts，
两者接口约定完全一致：POST /api/diagnose，返回 {"ok": true, "result": {...}}。

环境变量（写在项目根目录的 .env 里）：
  LLM_BASE_URL   默认 https://api.deepseek.com/v1
  LLM_MODEL      默认 deepseek-chat
  LLM_API_KEY    你的 key
  LLM_MOCK=1     不调用真模型，返回固定结果（用于测试）
"""
import hashlib
import json
import os
import re
import ssl
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAX_CODE_CHARS = 8000
CACHE_TTL = 3600
RATE_LIMIT_PER_HOUR = 120

_cache = {}   # key -> (timestamp, result)
_rate = {}    # ip -> [timestamps]


def load_env(path=None):
    """极简 .env 解析：KEY=VALUE，忽略 # 注释。不覆盖已有的系统环境变量。"""
    path = path or os.path.join(ROOT, ".env")
    values = {}
    if not os.path.exists(path):
        return values
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


ENV = load_env()


def setting(name, default=""):
    return os.environ.get(name) or ENV.get(name) or default


SYSTEM_PROMPT = """你是一名算法学习教练，负责诊断学生代码中的错误，并引导学生自己发现问题。

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
}"""


_SSL_CONTEXT = None


def ssl_context():
    """构造 TLS 上下文。

    有些 Python 环境（比如 msys2 自带的）没有配好根证书，直连 https 会报
    CERTIFICATE_VERIFY_FAILED。优先使用 certifi 的证书包；确实不行时，
    允许用 LLM_INSECURE_TLS=1 跳过校验（仅限本机开发，会在日志里警告）。
    """
    global _SSL_CONTEXT
    if _SSL_CONTEXT is not None:
        return _SSL_CONTEXT

    if os.environ.get("LLM_INSECURE_TLS") == "1":
        _SSL_CONTEXT = ssl._create_unverified_context()
        print("[warn] 已跳过 TLS 校验（LLM_INSECURE_TLS=1），仅限本机调试")
        return _SSL_CONTEXT

    try:
        import certifi  # 大多数环境都装了

        _SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
        return _SSL_CONTEXT
    except Exception:  # noqa: BLE001
        _SSL_CONTEXT = ssl.create_default_context()
        return _SSL_CONTEXT


def build_messages(code, problem=None, algorithm=None, language=None):
    parts = []
    if algorithm:
        parts.append(f"算法/知识点：{algorithm}")
    if language:
        parts.append(f"语言：{language}")
    if problem:
        parts.append(f"题目描述：{problem}")
    parts.append("学生代码（行号仅供参考，不要复述整段代码）：")
    numbered = "\n".join(f"{i+1:>3}| {line}" for i, line in enumerate(code.splitlines()))
    parts.append(numbered)
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": "\n".join(parts)},
    ]


def call_model(messages, timeout=25):
    base = setting("LLM_BASE_URL", "https://api.deepseek.com/v1").rstrip("/")
    model = setting("LLM_MODEL", "deepseek-chat")
    key = setting("LLM_API_KEY")
    if not key:
        raise RuntimeError("no_api_key")

    body = json.dumps(
        {
            "model": model,
            "messages": messages,
            "temperature": 0.2,
            "max_tokens": 600,
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        f"{base}/chat/completions",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout, context=ssl_context()) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"], model


def parse_model_output(text):
    """模型偶尔会带 ```json 围栏或前后废话，这里尽量兜住。"""
    if not text:
        return None
    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError:
            return None
    return None


CODE_LIKE = re.compile(r"(```|;\s*$|\breturn\b.*[;{}]|\bfor\s*\(|\bwhile\s*\()", re.M)

ALLOWED_TYPES = {"boundary", "complexity", "recursion", "logic", "type", "none"}
LABELS = {
    "boundary": "边界条件错误",
    "complexity": "复杂度问题",
    "recursion": "递归/终止条件问题",
    "logic": "逻辑结构问题",
    "type": "类型/溢出问题",
    "none": "未发现明确错误",
}


def sanitize(raw):
    """把模型输出收敛成前端能用的固定结构，并拦截代码泄漏。"""
    if not isinstance(raw, dict):
        return None

    error_type = str(raw.get("errorType", "")).strip().lower()
    if error_type not in ALLOWED_TYPES:
        error_type = "logic"

    def text(name, limit=200):
        value = raw.get(name, "")
        return str(value).strip()[:limit] if value is not None else ""

    hint = text("hint")
    question = text("question", 300)
    evidence = text("evidence", 300)

    leak = bool(CODE_LIKE.search(hint)) or hint.count("\n") > 1
    if leak:
        hint = "这段提示里可能包含完整代码，已隐藏。请先自己走一遍边界情况。"

    try:
        line = int(raw.get("line")) if raw.get("line") is not None else None
    except (TypeError, ValueError):
        line = None
    if line is not None and line <= 0:
        line = None

    try:
        confidence = float(raw.get("confidence", 0.6))
    except (TypeError, ValueError):
        confidence = 0.6
    confidence = max(0.0, min(1.0, confidence))

    if not question:
        question = "先说说这段代码每一步在做什么？它第一次出错会是在什么输入下？"

    return {
        "errorType": error_type,
        "label": text("label", 40) or LABELS[error_type],
        "line": line,
        "evidence": evidence or "模型没有给出具体依据",
        "question": question,
        "hint": hint,
        "confidence": confidence,
        "forbidCompleteSolution": True,
        "codeLeakRemoved": leak,
    }


def mock_result(code):
    """不调模型时的固定输出，用来测通链路。"""
    return sanitize(
        {
            "errorType": "boundary",
            "label": "边界条件错误",
            "line": 1,
            "evidence": "（模拟）循环上界用了包含等号的比较",
            "question": "如果数组只有 3 个元素，循环最后一次访问的下标是几？",
            "hint": "先手算 n=3 时循环会执行几次。",
            "confidence": 0.5,
        }
    )


def rate_limited(ip):
    now = time.time()
    hits = [t for t in _rate.get(ip, []) if now - t < 3600]
    if len(hits) >= RATE_LIMIT_PER_HOUR:
        _rate[ip] = hits
        return True
    hits.append(now)
    _rate[ip] = hits
    return False


def handle(payload, client_ip="local"):
    """返回 (HTTP 状态码, 响应体 dict)。"""
    code = str(payload.get("code", ""))[:MAX_CODE_CHARS]
    if len(code.strip()) < 5:
        return 400, {"ok": False, "reason": "empty_code", "message": "代码太短，没法诊断。"}

    if rate_limited(client_ip):
        return 429, {"ok": False, "reason": "rate_limited", "message": "调用太频繁，休息一会儿再试。"}

    if setting("LLM_MOCK") == "1":
        return 200, {
            "ok": True,
            "result": mock_result(code),
            "meta": {"model": "mock", "latency_ms": 0, "cached": False},
        }

    key = hashlib.sha256(
        (code + "|" + str(payload.get("problem", "")) + "|" + setting("LLM_MODEL", "deepseek-chat")).encode("utf-8")
    ).hexdigest()

    cached = _cache.get(key)
    if cached and time.time() - cached[0] < CACHE_TTL:
        return 200, {
            "ok": True,
            "result": cached[1],
            "meta": {"model": setting("LLM_MODEL", "deepseek-chat"), "latency_ms": 0, "cached": True},
        }

    if not setting("LLM_API_KEY"):
        return 200, {"ok": False, "reason": "no_api_key", "message": "服务端还没有配置模型 key。"}

    started = time.time()
    try:
        content, model = call_model(
            build_messages(
                code,
                problem=payload.get("problem"),
                algorithm=payload.get("algorithm"),
                language=payload.get("language"),
            )
        )
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "ignore")[:400]
        try:
            short = json.loads(detail)["error"]["message"][:100]
        except Exception:  # noqa: BLE001
            short = detail[:100]
        return 502, {
            "ok": False,
            "reason": "upstream_error",
            "message": f"模型接口返回 {exc.code}：{short}",
            "detail": detail,
        }
    except urllib.error.URLError as exc:
        return 502, {"ok": False, "reason": "network_error", "message": f"连不上模型接口：{exc.reason}"}
    except RuntimeError as exc:
        return 200, {"ok": False, "reason": str(exc), "message": "服务端还没有配置模型 key。"}
    except Exception as exc:  # 超时等
        return 502, {"ok": False, "reason": "unknown_error", "message": str(exc)[:200]}

    result = sanitize(parse_model_output(content))
    if result is None:
        return 502, {"ok": False, "reason": "bad_output", "message": "模型返回的内容无法解析"}

    _cache[key] = (time.time(), result)
    return 200, {
        "ok": True,
        "result": result,
        "meta": {"model": model, "latency_ms": int((time.time() - started) * 1000), "cached": False},
    }

ANALYZE_PROMPT = """你是算法竞赛教练。用户给了一份基于真实做题记录算出的行为数据（含六维分值，但对外不要提分数）。

请写一份诊断，只输出一个 JSON 对象，不要 Markdown、不要多余文字：
{
  "summary": "两句话：整体水平如何、最该补的方向。不要出现任何分数或百分比。",
  "strengths": ["强势的算法/题型，最多 3 条，每条不超过 30 字"],
  "weaknesses": ["弱势的算法/题型，最多 3 条，每条不超过 30 字"],
  "suggestions": ["最多 3 条，每条不超过 30 字，要具体：练哪类算法、什么难度、什么节奏"],
  "correctionProfile": "一句话描述纠错风格（小步调试 / 频繁重写 / 一次通过等），证据不足就写“证据不足”"
}

硬性要求：
1. 不要在任何文字里出现分数、评分、百分比数字。
2. strengths / weaknesses 必须点名具体算法或题型（例如动态规划、二分、图论、贪心），依据"algorithms"字段；
   如果 algorithms 为空，就按难度层描述，并在 summary 里说明“尚未获取题目标签”。
3. 只依据给出的数据，不要编造没有的信息；某个维度为 null 视为数据不足，不要据此下结论。
4. 语气像教练，不说“多练习”这类废话。
"""


def handle_analyze(payload, client_ip="local"):
    """六维分析：把数字交给大模型，让它写诊断报告。"""
    import hashlib

    dims = payload.get("dims") or {}
    stats = payload.get("stats") or {}

    if not dims:
        return 400, {"ok": False, "reason": "empty", "message": "没有可分析的数据"}

    if rate_limited(client_ip):
        return 429, {"ok": False, "reason": "rate_limited", "message": "调用太频繁，休息一会儿再试"}

    if setting("LLM_MOCK") == "1":
        return 200, {
            "ok": True,
            "result": {
                "summary": "（模拟）基础题稳定，但提高档明显吃力，动态规划是主要短板。",
                "strengths": ["贪心：通过率高，基本一次过"],
                "weaknesses": ["动态规划：反复提交仍做不出", "图论：练得少、错误集中"],
                "suggestions": ["先刷 10 道线性 DP，再上区间 DP", "每周两道提高+ 的图论题"],
                "correctionProfile": "以小步调试为主，偶尔整段重写"
            },
            "meta": {"model": "mock", "latency_ms": 0, "cached": False},
        }

    key = hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
    cached = _cache.get(key)
    if cached and time.time() - cached[0] < CACHE_TTL:
        return 200, {"ok": True, "result": cached[1], "meta": {"model": setting("LLM_MODEL", "deepseek-chat"), "latency_ms": 0, "cached": True}}

    if not setting("LLM_API_KEY"):
        return 200, {"ok": False, "reason": "no_api_key", "message": "服务端还没有配置模型 key"}

    user_text = json.dumps(
        {"dims": dims, "stats": stats, "algorithms": payload.get("algorithms") or {}},
        ensure_ascii=False,
    )[:4000]
    messages = [
        {"role": "system", "content": ANALYZE_PROMPT},
        {"role": "user", "content": user_text},
    ]

    started = time.time()
    try:
        content, model = call_model(messages)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "ignore")[:300]
        return 502, {"ok": False, "reason": "upstream_error", "message": f"模型接口返回 {exc.code}", "detail": detail}
    except urllib.error.URLError as exc:
        return 502, {"ok": False, "reason": "network_error", "message": f"连不上模型接口：{exc.reason}"}
    except Exception as exc:  # noqa: BLE001
        return 502, {"ok": False, "reason": "unknown_error", "message": str(exc)[:200]}

    data = parse_model_output(content)
    if not isinstance(data, dict):
        return 502, {"ok": False, "reason": "bad_output", "message": "模型返回的内容无法解析"}

    def as_list(value, limit=3):
        if not isinstance(value, list):
            return []
        return [str(item).strip()[:80] for item in value if str(item).strip()][:limit]

    result = {
        "summary": str(data.get("summary", "")).strip()[:200],
        "strengths": as_list(data.get("strengths")),
        "weaknesses": as_list(data.get("weaknesses")),
        "suggestions": as_list(data.get("suggestions")),
        "correctionProfile": str(data.get("correctionProfile", "")).strip()[:120],
    }

    _cache[key] = (time.time(), result)
    return 200, {
        "ok": True,
        "result": result,
        "meta": {"model": model, "latency_ms": int((time.time() - started) * 1000), "cached": False},
    }