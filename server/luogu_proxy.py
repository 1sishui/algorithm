"""
洛谷数据代理（本机）

背景：
  - 洛谷没有开放 API；
  - /record/list 在没有登录态时直接 401，所以「公开记录」这条路实际上走不通；
  - 但页面里嵌了 window._feInjection（URL 编码的 JSON），里面就有数据。

策略：
  1. 带 Cookie 请求（可选），用 cookie jar 处理洛谷的 C3VK 防爬跳转；
  2. 优先按 JSON 解析（_contentOnly=1），拿不到就从 HTML 里抠 _feInjection；
  3. 全程不落盘、不打印 Cookie。
"""
import http.cookiejar
import json
import re
import socket
import ssl
import urllib.error
import urllib.parse
import urllib.request

LUOGU_BASE = "https://www.luogu.com.cn"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

socket.setdefaulttimeout(15)

_FE_INJECTION = re.compile(r'_feInjection\s*=\s*JSON\.parse\(decodeURIComponent\("([^"]+)"\)\)')


def _ssl_context():
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:  # noqa: BLE001
        return ssl.create_default_context()


def _make_jar(cookie_str=""):
    jar = http.cookiejar.CookieJar()
    for part in str(cookie_str or "").split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        name, _, value = part.partition("=")
        name, value = name.strip(), value.strip()
        if not name:
            continue
        jar.set_cookie(
            http.cookiejar.Cookie(
                0, name, value, None, False, "www.luogu.com.cn", False, False,
                "/", True, False, None, False, None, None, {}
            )
        )
    return jar


def _opener(cookie_str=""):
    """构造带 cookie jar 的 opener：洛谷会先 302 下发 C3VK，再让你重新请求。"""
    return urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(_make_jar(cookie_str)),
        urllib.request.HTTPSHandler(context=_ssl_context()),
    )


def _get(url, cookie="", accept="application/json", timeout=15, ajax=True):
    """返回 (状态码, 文本, content-type, 最终URL)。401/403 抛 PermissionError。"""
    headers = {
        "User-Agent": UA,
        "Accept": accept,
        "Referer": LUOGU_BASE + "/",
    }
    if ajax:
        headers["x-luogu-type"] = "content-only"
        headers["X-Requested-With"] = "XMLHttpRequest"

    req = urllib.request.Request(url, headers=headers)
    try:
        with _opener(cookie).open(req, timeout=timeout) as resp:
            return (
                resp.status,
                resp.read().decode("utf-8", "ignore"),
                resp.headers.get("Content-Type", ""),
                resp.geturl(),
            )
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            body = ""
            try:
                body = exc.read().decode("utf-8", "ignore")[:300]
            except Exception:  # noqa: BLE001
                pass
            err = PermissionError(exc.code)
            err.body = body
            err.url = exc.geturl() if hasattr(exc, "geturl") else url
            raise err from exc
        raise


def _extract_injection(html):
    """从页面里抠出 _feInjection，再解出 JSON。"""
    match = _FE_INJECTION.search(html)
    if not match:
        return None
    try:
        return json.loads(urllib.parse.unquote(match.group(1)))
    except (ValueError, TypeError):
        return None


def _parse_payload(text):
    """优先 JSON，其次页面内嵌数据。"""
    stripped = text.lstrip()
    if stripped.startswith("{"):
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return None
    return _extract_injection(text)


def _records_from(data):
    box = (data.get("currentData") or {}).get("records") or data.get("records") or {}
    return box.get("result") or [], box


def fetch_records_with_cookie(uid, page=1, cookie="", timeout=15):
    """
    用登录态读记录。洛谷的接口有两套形态，挨个试：
      1) /record/list?_contentOnly=1  → 直接返回 JSON 片段
      2) /record/list                 → 返回整页 HTML，数据藏在 _feInjection 里
    两条都失败时，把上游的真实状态码带回去，方便判断到底卡在哪。
    """
    uid = str(uid or "").strip()
    if not uid.isdigit():
        return 400, {"ok": False, "reason": "bad_uid", "message": "UID 应该是纯数字"}
    if not cookie or len(cookie) < 10:
        return 400, {"ok": False, "reason": "no_cookie", "message": "Cookie 为空"}

    attempts = []
    base = f"{LUOGU_BASE}/record/list?user={urllib.parse.quote(uid)}&page={int(page)}"

    # 方案一：JSON 片段
    try:
        status, text, ctype, final = _get(base + "&_contentOnly=1", cookie=cookie, timeout=timeout)
        data = _parse_payload(text)
        if data:
            records, box = _records_from(data)
            if records:
                return 200, {
                    "ok": True,
                    "records": records,
                    "perPage": box.get("perPage") or 20,
                    "count": box.get("count"),
                    "page": int(page),
                    "via": "json",
                }
            attempts.append(f"JSON接口返回 0 条（HTTP {status}）")
        else:
            attempts.append(f"JSON接口返回的不是数据（HTTP {status}，{ctype}）")
    except PermissionError as exc:
        snippet = _plain(getattr(exc, "body", ""))
        attempts.append(f"JSON接口 HTTP {exc}" + (f"：{snippet}" if snippet else ""))
    except socket.timeout:
        attempts.append("JSON接口 超时")
    except Exception as exc:  # noqa: BLE001
        attempts.append(f"JSON接口 出错：{str(exc)[:80]}")

    # 方案二：整页 HTML + 内嵌数据
    try:
        status, text, ctype, final = _get(base, cookie=cookie, accept="text/html", timeout=timeout, ajax=False)
        data = _extract_injection(text)
        if data:
            records, box = _records_from(data)
            if records:
                return 200, {
                    "ok": True,
                    "records": records,
                    "perPage": box.get("perPage") or 20,
                    "count": box.get("count"),
                    "page": int(page),
                    "via": "html",
                }
            attempts.append("页面能打开，但里面没有记录数据")
        else:
            attempts.append(f"页面没有内嵌数据（HTTP {status}，{len(text)} 字节）")
    except PermissionError as exc:
        snippet = _plain(getattr(exc, "body", ""))
        attempts.append(f"页面接口 HTTP {exc}" + (f"：{snippet}" if snippet else ""))
    except socket.timeout:
        attempts.append("页面接口 超时")
    except Exception as exc:  # noqa: BLE001
        attempts.append(f"页面接口 出错：{str(exc)[:80]}")

    hint = "洛谷现在返回的是网页外壳（SPA），数据由浏览器里的 JS 加载，服务端拿不到。"
    return 200, {
        "ok": False,
        "reason": "spa_shell",
        "message": hint + "具体：" + "；".join(attempts),
        "attempts": attempts,
        "detail": "；".join(attempts)[:400],
    }
_TAG = re.compile(r"<[^>]+>")


def _plain(text):
    """把 HTML 片段压成一行短文本，方便显示在状态栏里。"""
    if not text:
        return ""
    cleaned = _TAG.sub(" ", text)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:80]