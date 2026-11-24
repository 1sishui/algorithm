"""诊断质量抽检：用真实模型跑 10 段典型错误代码，看判得准不准。

用法：
    1) 先双击 启动.bat（或另开窗口跑 python serve.py）
    2) python test/spotcheck.py            # 默认连 127.0.0.1:8123
       python test/spotcheck.py 8128       # 指定端口

输出：控制台表格 + test/spotcheck_result.md（可以直接贴进周报/中期材料）

判定口径：
    - 严格命中：errorType 完全等于预期
    - 可接受：落在该题的“可接受集合”里（有些错误天然跨类，比如溢出算 type 还是 boundary）
    - 误报：正确代码被判成有错
"""
import json
import os
import statistics
import sys
import time
import urllib.error
import urllib.request

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
BASE = f"http://127.0.0.1:{PORT}/api/diagnose"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "test", "spotcheck_result.md")

CASES = [
    {
        "name": "循环越界",
        "expect": ["boundary"],
        "code": "int sum(int a[], int n) {\n  int s = 0;\n  for (int i = 0; i <= n; i++) s += a[i];\n  return s;\n}",
    },
    {
        "name": "二分中点溢出",
        "expect": ["type", "boundary"],
        "code": "int bs(int a[], int n, int x) {\n  int l = 0, r = n - 1;\n  while (l <= r) {\n    int mid = (l + r) / 2;\n    if (a[mid] == x) return mid;\n    if (a[mid] < x) l = mid + 1; else r = mid - 1;\n  }\n  return -1;\n}",
    },
    {
        "name": "递归无终止条件",
        "expect": ["recursion"],
        "code": "int f(int n) {\n  return f(n - 1) + 1;\n}",
    },
    {
        "name": "空数组未处理",
        "expect": ["boundary"],
        "code": "int first(int a[]) {\n  return a[0];\n}",
    },
    {
        "name": "二分死循环",
        "expect": ["logic", "complexity"],
        "code": "int bs(int a[], int n, int x) {\n  int l = 0, r = n - 1;\n  while (l < r) {\n    int mid = (l + r) / 2;\n    if (a[mid] < x) l = mid;\n    else r = mid;\n  }\n  return -1;\n}",
    },
    {
        "name": "比较方向写反（想升序却降序）",
        "expect": ["logic"],
        "code": "void sort(int a[], int n) {\n  for (int i = 0; i < n; i++)\n    for (int j = i + 1; j < n; j++)\n      if (a[i] < a[j]) std::swap(a[i], a[j]);\n}",
    },
    {
        "name": "变量未初始化",
        "expect": ["logic"],
        "code": "int sum(int a[], int n) {\n  int s;\n  for (int i = 0; i < n; i++) s += a[i];\n  return s;\n}",
    },
    {
        "name": "字符串取到 length 位",
        "expect": ["boundary"],
        "code": "int lastChar(string s) {\n  return s[s.length()];\n}",
    },
    {
        "name": "DP 数组越界",
        "expect": ["boundary"],
        "code": "int dp[1000];\nint f(int n) {\n  dp[0] = 0;\n  for (int i = 1; i <= n; i++) dp[i] = dp[i - 1] + 1;\n  return dp[n];\n}",
    },
    {
        "name": "正确代码（不应误报）",
        "expect": ["none"],
        "code": "int add(int a, int b) {\n  return a + b;\n}",
    },
]


def post(payload, timeout=60, retries=2):
    """调用诊断接口；遇到 429/502/503 自动退避重试（免费额度常见限流）。"""
    data = json.dumps(payload).encode("utf-8")
    last_error = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(
            BASE, data=data, headers={"Content-Type": "application/json"}, method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "ignore")[:160]
            last_error = f"HTTP {exc.code} {detail}"
            if exc.code in (429, 502, 503) and attempt < retries:
                time.sleep(2 + attempt * 2)
                continue
            raise
        except urllib.error.URLError as exc:
            last_error = str(exc.reason)
            if attempt < retries:
                time.sleep(2 + attempt * 2)
                continue
            raise
    raise RuntimeError(last_error)


def main():
    rows = []
    latencies = []

    print(f"目标：{BASE}\n")
    for i, case in enumerate(CASES, 1):
        started = time.time()
        try:
            body = post({"code": case["code"], "language": "C++"})
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "ignore")[:120]
            print(f"[{i}] {case['name']} —— 服务返回 HTTP {exc.code}：{detail}")
            rows.append((case["name"], "-", "-", f"HTTP {exc.code}", 0, ""))
            continue
        except urllib.error.URLError as exc:
            print(f"连不上服务：{exc.reason}")
            print("请先双击 启动.bat，确认窗口里显示「连接测试：通过」")
            return 1

        elapsed = int((time.time() - started) * 1000)
        if not body.get("ok"):
            print(f"[{i}] {case['name']} —— 调用失败：{body.get('reason')} {body.get('message', '')}")
            rows.append((case["name"], "-", "-", "调用失败", elapsed, ""))
            continue

        result = body["result"]
        got = result.get("errorType")
        strict = got in case["expect"]
        acceptable = strict or got in case["expect"]

        latencies.append(elapsed)
        rows.append(
            (
                case["name"],
                "/".join(case["expect"]),
                got,
                "✅" if strict else "❌",
                elapsed,
                result.get("question", "")[:40],
            )
        )
        mark = "OK  " if strict else "MISS"
        print(f"[{i}] {case['name']:<24} 预期 {case['expect']}  实际 {got:<10} {mark}  {elapsed}ms")

    total = len(rows)
    ok = sum(1 for r in rows if r[3] == "✅")
    print("\n" + "=" * 60)
    print(f"命中 {ok}/{total} = {ok / total * 100:.0f}%")
    if latencies:
        print(f"平均延迟 {statistics.mean(latencies):.0f} ms，最慢 {max(latencies)} ms")

    lines = [
        "# 诊断质量抽检结果\n",
        f"- 时间：{time.strftime('%Y-%m-%d %H:%M')}",
        f"- 接口：{BASE}",
        f"- 命中：{ok}/{total}（{ok / total * 100:.0f}%）",
        "",
        "| # | 用例 | 预期 | 实际 | 结果 | 延迟 | 引导提问（截断） |",
        "|---|---|---|---|---|---|---|",
    ]
    for i, r in enumerate(rows, 1):
        lines.append(f"| {i} | {r[0]} | {r[1]} | {r[2]} | {r[3]} | {r[4]}ms | {r[5]} |")
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    print(f"\n明细已写入：{OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())