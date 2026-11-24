"""
洛谷数据代理（本机）

为什么需要它：洛谷的提交记录接口不带 CORS 头，浏览器直接 fetch 会被拦；
所以由本地服务去取，再把结果交给页面。全程只读公开记录，不保存 Cookie、不碰密码。

注意：
  - 只按 UID 读取**公开**的提交记录；如果对方设置了隐私，会返回“取不到”
  - 每次同步只拉前几页，避免给洛谷造成压力（10 分钟一次的节奏）
"""
import json
import socket
import ssl
import urllib.error
import urllib.parse
import urllib.request

LUOGU_BASE = "https://www.luogu.com.cn"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

# DNS 解析不受 urllib 的 timeout 控制，这里兜一层，避免请求一直挂着
socket.setdefaulttimeout(15)


def _ssl_context():
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:  # noqa: BLE001
        return ssl.create_default_context()


def fetch_user(uid, timeout=12):
    """取用户公开资料（昵称、头像），用来让用户确认“这是不是我”。"""
    uid = str(uid or "").strip()
    if not uid.isdigit():
        return 400, {"ok": False, "reason": "bad_uid", "message": "UID 应该是纯数字"}

    url = f"{LUOGU_BASE}/user/{urllib.parse.quote(uid)}?_contentOnly=1"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "x-luogu-type": "content-only",
            "Accept": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_ssl_context()) as resp:
            data = json.loads(resp.read().decode("utf-8", "ignore"))
    except socket.timeout:
        return 200, {"ok": False, "reason": "timeout", "message": "洛谷响应超时"}
    except urllib.error.HTTPError as exc:
        return 200, {"ok": False, "reason": f"http_{exc.code}", "message": f"洛谷返回 {exc.code}"}
    except Exception as exc:  # noqa: BLE001
        return 200, {"ok": False, "reason": "network", "message": f"连不上洛谷：{exc}"}

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


def fetch_records(uid, page=1, timeout=12):
    """返回 (状态码, 响应体 dict)。"""
    uid = str(uid or "").strip()
    if not uid.isdigit():
        return 400, {"ok": False, "reason": "bad_uid", "message": "UID 应该是纯数字（个人主页网址里的那串）"}

    url = (
        f"{LUOGU_BASE}/record/list?user={urllib.parse.quote(uid)}"
        f"&page={int(page)}&_contentOnly=1"
    )
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Referer": f"{LUOGU_BASE}/user/{uid}",
            "x-luogu-type": "content-only",
            "Accept": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_ssl_context()) as resp:
            raw = resp.read().decode("utf-8", "ignore")
    except urllib.error.HTTPError as exc:
        if exc.code in (301, 302, 303, 307, 308):
            return 200, {
                "ok": False,
                "reason": "login_required",
                "message": "洛谷把这个请求跳转到了登录页（302）：说明记录不公开，或者该接口需要登录态。可以开放隐私设置，或改用控制台脚本。",
            }
        if exc.code in (403, 401):
            return 200, {
                "ok": False,
                "reason": "forbidden",
                "message": "洛谷拒绝了请求：记录可能设了隐私，或需要登录。可以改用控制台脚本导出。",
            }
        return 200, {"ok": False, "reason": f"http_{exc.code}", "message": f"洛谷返回 {exc.code}"}
    except urllib.error.URLError as exc:
        return 200, {"ok": False, "reason": "network", "message": f"连不上洛谷：{exc.reason}"}
    except socket.timeout:
        return 200, {"ok": False, "reason": "timeout", "message": "洛谷响应超时，稍后再试或改用控制台脚本"}
    except Exception as exc:  # noqa: BLE001
        return 200, {"ok": False, "reason": "unknown", "message": str(exc)[:160]}

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return 200, {
            "ok": False,
            "reason": "bad_response",
            "message": "洛谷返回的不是 JSON，可能触发了验证页。请改用控制台脚本导出。",
        }

    current = data.get("currentData") or {}
    box = current.get("records") or data.get("records") or {}
    records = box.get("result") or []

    return 200, {
        "ok": True,
        "records": records,
        "perPage": box.get("perPage") or 20,
        "count": box.get("count"),
        "page": int(page),
    }