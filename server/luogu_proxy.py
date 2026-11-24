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


def _opener(cookie_str=""):
    """构造带 cookie jar 的 opener：洛谷会先 302 下发 C3VK，再让你重新请求。"""
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
    return urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(jar),
        urllib.request.HTTPSHandler(context=_ssl_context()),
    )


def _get(url, cookie="", accept="application/json", timeout=15):
    """返回 (状态码, 文本, content-type)。401/403 会抛 PermissionError。"""
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Accept": accept,
            "x-luogu-type": "content-only",
            "Referer": LUOGU_BASE + "/",
        },
    )
    try:
        with _opener(cookie).open(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", "ignore"), resp.headers.get("Content-Type", "")
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise PermissionError(exc.code) from exc
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


def fetch_user(uid, timeout=15):
    uid = str(uid or "").strip()
    if not uid.isdigit():
        return 400, {"ok": False, "reason": "bad_uid", "message": "UID 应该是纯数字"}

    try:
        _status, text, _ctype = _get(f"{LUOGU_BASE}/user/{uid}", accept="text/html", timeout=timeout)
    except PermissionError:
        return 200, {"ok": False, "reason": "forbidden", "message": "洛谷拒绝了请求，稍后再试"}
    except socket.timeout:
        return 200, {"ok": False, "reason": "timeout", "message": "洛谷响应超时"}
    except Exception as exc:  # noqa: BLE001
        return 200, {"ok": False, "reason": "network", "message": f"连不上洛谷：{exc}"}

    data = _parse_payload(text)
    if not data:
        return 200, {"ok": False, "reason": "bad_response", "message": "没解析出页面数据"}

    user = (data.get("currentData") or {}).get("user") or {}
    name = user.get("name") or ""
    if not name:
        return 200, {"ok": False, "reason": "not_found", "message": "查不到这个 UID 的用户"}

    return 200, {
        "ok": True,
        "uid": str(user.get("uid") or uid),
        "name": name,
        "avatar": user.get("avatar") or "",
        "slogan": user.get("slogan") or "",
    }


def fetch_records_with_cookie(uid, page=1, cookie="", timeout=15):
    """用登录态读记录（洛谷的 /record/list 没有登录态会 401）。"""
    uid = str(uid or "").strip()
    if not uid.isdigit():
        return 400, {"ok": False, "reason": "bad_uid", "message": "UID 应该是纯数字"}
    if not cookie or len(cookie) < 10:
        return 400, {"ok": False, "reason": "no_cookie", "message": "Cookie 为空"}

    url = f"{LUOGU_BASE}/record/list?user={urllib.parse.quote(uid)}&page={int(page)}&_contentOnly=1"
    try:
        _status, text, _ctype = _get(url, cookie=cookie, timeout=timeout)
    except PermissionError:
        return 200, {"ok": False, "reason": "login_required", "message": "洛谷返回 401：Cookie 无效或已过期，请重新复制"}
    except socket.timeout:
        return 200, {"ok": False, "reason": "timeout", "message": "洛谷响应超时"}
    except Exception as exc:  # noqa: BLE001
        return 200, {"ok": False, "reason": "network", "message": f"连不上洛谷：{exc}"}

    data = _parse_payload(text)
    if not data:
        return 200, {"ok": False, "reason": "login_required", "message": "没解析出记录：Cookie 可能已过期"}

    box = (data.get("currentData") or {}).get("records") or data.get("records") or {}
    records = box.get("result") or []
    if not records:
        return 200, {
            "ok": False,
            "reason": "empty",
            "message": "记录为空：可能是 UID 不对，或这个账号没有提交记录",
        }

    return 200, {
        "ok": True,
        "records": records,
        "perPage": box.get("perPage") or 20,
        "count": box.get("count"),
        "page": int(page),
    }


def fetch_records(uid, page=1, timeout=15):
    """不带 Cookie 的尝试（大概率 401，保留是为了给出明确提示）。"""
    uid = str(uid or "").strip()
    if not uid.isdigit():
        return 400, {"ok": False, "reason": "bad_uid", "message": "UID 应该是纯数字"}

    url = f"{LUOGU_BASE}/record/list?user={urllib.parse.quote(uid)}&page={int(page)}&_contentOnly=1"
    try:
        _status, text, _ctype = _get(url, timeout=timeout)
    except PermissionError:
        return 200, {
            "ok": False,
            "reason": "login_required",
            "message": "洛谷要求登录：记录必须带 Cookie 才能读。填下面的 Cookie 再同步。",
        }
    except socket.timeout:
        return 200, {"ok": False, "reason": "timeout", "message": "洛谷响应超时"}
    except Exception as exc:  # noqa: BLE001
        return 200, {"ok": False, "reason": "network", "message": f"连不上洛谷：{exc}"}

    data = _parse_payload(text)
    if not data:
        return 200, {"ok": False, "reason": "login_required", "message": "洛谷要求登录"}

    box = (data.get("currentData") or {}).get("records") or data.get("records") or {}
    records = box.get("result") or []
    return 200, {
        "ok": True,
        "records": records,
        "perPage": box.get("perPage") or 20,
        "count": box.get("count"),
        "page": int(page),
    }