"""
本地预览服务：静态文件 + 大模型诊断代理。

  GET  /                 → 静态页面
  GET  /api/health       → 配置自检（不消耗 token）；加 ?probe=1 会真的调一次模型
  POST /api/diagnose     → 调用大模型做错误诊断（key 只存在服务端）

单文件离线版不经过这里，所以离线版永远用本地规则 —— 这是设计好的降级行为。

关掉这个窗口 = 停止服务。
"""
import functools
import http.server
import json
import os
import socketserver
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT") or 8123)
VERSION = "0.3"

sys.path.insert(0, ROOT)
from server import llm_proxy  # noqa: E402
from server import luogu_proxy  # noqa: E402


def mask_key(key):
    if not key:
        return "（空）"
    if len(key) <= 12:
        return key[:4] + "..."
    return f"{key[:6]}...{key[-4:]}（长度 {len(key)}）"


def probe_model():
    """启动时校验一次 key，把结果直接打在窗口里，省得去浏览器猜。"""
    if not llm_proxy.setting("LLM_API_KEY"):
        return "未配置 key"
    try:
        content, model = llm_proxy.call_model(
            [{"role": "user", "content": "请只回复两个字：正常"}], timeout=20
        )
        return f"通过（{model} 回复：{content.strip()[:20]}）"
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "ignore")[:160]
        return f"失败 HTTP {exc.code}：{detail}"
    except urllib.error.URLError as exc:
        return f"失败（网络）：{exc.reason}"
    except Exception as exc:  # noqa: BLE001
        return f"失败：{exc}"


def health_payload(with_probe=False):
    env_path = os.path.join(ROOT, ".env")
    payload = {
        "ok": True,
        "service": "algo-agent",
        "version": VERSION,
        "model": llm_proxy.setting("LLM_MODEL", "deepseek-chat"),
        "base_url": llm_proxy.setting("LLM_BASE_URL", "https://api.deepseek.com/v1"),
        "key_configured": bool(llm_proxy.setting("LLM_API_KEY")),
        "key_masked": mask_key(llm_proxy.setting("LLM_API_KEY")),
        "env_file": env_path,
        "env_found": os.path.exists(env_path),
    }
    if with_probe:
        payload["probe"] = probe_model()
    return payload


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def _send_json(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path, _, query = self.path.partition("?")
        if path == "/api/health":
            self._send_json(200, health_payload(with_probe="probe=1" in query))
            return
        super().do_GET()

    def do_POST(self):
        path = self.path.split("?")[0]
        if path not in ("/api/diagnose", "/api/analyze", "/api/luogu/records", "/api/luogu/record", "/api/luogu/problem"):
            self.send_error(404, "Not Found")
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > 200_000:
            self._send_json(400, {"ok": False, "reason": "bad_request", "message": "请求体为空或过大"})
            return

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError
        except (ValueError, UnicodeDecodeError):
            self._send_json(400, {"ok": False, "reason": "bad_json", "message": "请求体不是合法 JSON"})
            return

        if path == "/api/analyze":
            try:
                status, body = llm_proxy.handle_analyze(payload, client_ip=self.client_address[0])
            except Exception as exc:  # noqa: BLE001
                status, body = 500, {"ok": False, "reason": "proxy_error", "message": str(exc)[:200]}
            print(f"[analyze] {status} ok={body.get('ok')} reason={body.get('reason', '-')}", flush=True)
            self._send_json(status, body)
            return

        if path == "/api/luogu/problem":
            pid = str(payload.get("pid") or "")
            cookie = str(payload.get("cookie") or "")
            try:
                status, body = luogu_proxy.fetch_problem_tags(pid, cookie)
            except Exception as exc:  # noqa: BLE001
                status, body = 500, {"ok": False, "reason": "proxy_error", "message": str(exc)[:160]}
            print(f"[luogu] tags pid={pid} ok={body.get('ok')}", flush=True)
            self._send_json(status, body)
            return

        if path == "/api/luogu/record":
            rid = str(payload.get("id") or "")
            cookie = str(payload.get("cookie") or "")
            try:
                status, body = luogu_proxy.fetch_record_code(rid, cookie)
            except Exception as exc:  # noqa: BLE001
                status, body = 500, {"ok": False, "reason": "proxy_error", "message": str(exc)[:160]}
            print(f"[luogu] code id={rid} ok={body.get('ok')} reason={body.get('reason', '-')}", flush=True)
            self._send_json(status, body)
            return

        if path == "/api/luogu/records":
            uid = str(payload.get("uid") or "")
            cookie = str(payload.get("cookie") or "")
            try:
                page = int(payload.get("page") or 1)
            except (TypeError, ValueError):
                page = 1
            try:
                status, body = luogu_proxy.fetch_records_with_cookie(uid, page, cookie)
            except Exception as exc:  # noqa: BLE001
                status, body = 500, {"ok": False, "reason": "proxy_error", "message": str(exc)[:160]}
            # 只记录结果，绝不打印 Cookie
            print(f"[luogu] cookie uid={uid} page={page} ok={body.get('ok')} reason={body.get('reason', '-')}", flush=True)
            self._send_json(status, body)
            return

        try:
            status, body = llm_proxy.handle(payload, client_ip=self.client_address[0])
        except Exception as exc:  # 代理自身不能把服务打挂
            status, body = 500, {"ok": False, "reason": "proxy_error", "message": str(exc)[:200]}

        # 打在窗口里，出问题时截这行就够定位
        print(
            f"[api] {status} ok={body.get('ok')} reason={body.get('reason', '-')} "
            f"model={body.get('meta', {}).get('model', '-')}",
            flush=True,
        )
        self._send_json(status, body)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # 静态资源日志太吵


def main() -> int:
    os.chdir(ROOT)
    try:
        sys.stdout.reconfigure(line_buffering=True)  # 窗口里即时看到输出
    except (AttributeError, ValueError):
        pass
    try:
        httpd = socketserver.ThreadingTCPServer(("127.0.0.1", PORT), Handler)
    except OSError:
        print(f"端口 {PORT} 已被占用。")
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/health", timeout=3) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            print(f"检测到已经在运行的服务：v{data.get('version', '?')}，模型 {data.get('model', '?')}")
            if str(data.get("version", "")) == VERSION:
                print("这就是最新版，直接用浏览器打开即可。")
        except Exception:  # noqa: BLE001
            print("占用端口的是一个旧版服务（没有 /api/health 接口），它不会转发大模型请求。")
            print("请双击「重启服务.bat」：它会先关掉旧进程再启动新版。")

        webbrowser.open(f"http://127.0.0.1:{PORT}/api/health")
        try:
            input("按回车键退出...")
        except EOFError:
            pass
        return 1

    url = f"http://127.0.0.1:{PORT}/"
    env_path = os.path.join(ROOT, ".env")
    key = llm_proxy.setting("LLM_API_KEY")

    print("=" * 56)
    print("  算法学习智能体 · 本地预览  v" + VERSION)
    print(f"  地址：{url}")
    print(f"  配置文件：{env_path}")
    print(f"            {'已找到' if os.path.exists(env_path) else '未找到（可复制 .env.example 改名）'}")
    print(f"  模型：{llm_proxy.setting('LLM_MODEL', 'deepseek-chat')}")
    print(f"  Key：{mask_key(key)}")
    base_url = llm_proxy.setting("LLM_BASE_URL", "https://api.deepseek.com/v1")
    if key and "deepseek.com" in base_url and (len(key) > 60 or not key.startswith("sk-")):
        print("  提示：这个 key 不像 DeepSeek 官方 key（官方通常是 sk- 开头、约 35 位），")
        print("        请确认是从 platform.deepseek.com 的 API keys 页面复制的。")
    if key:
        print(f"  连接测试：{probe_model()}")
    print("  关闭这个窗口即可停止服务")
    print("=" * 56)

    if os.environ.get("NO_BROWSER") != "1":
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())