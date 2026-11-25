# 项目交接说明（HANDOFF）

> 新会话/新同事接手时，**先读这一页**，再读 `BACKLOG.md` 和 `git log --oneline`。
> 目的：不靠聊天记录也能恢复上下文。每次大改动后请更新本文档。

## 一句话

成都东软学院 2026 校级学生科研项目：**面向算法学习的导向型智能体**。
纯前端 + Serverless，做三件事：算法可视化、错误诊断（大模型）、基于真实做题记录的六维评估。

## 要跑

| 文件 | 作用 |
|---|---|
| `启动.bat` | 起本地服务（`serve.py`，端口 8123），会先关掉旧进程 |
| `上传代码.bat` | git add + commit + **推送当前分支**（不是 main） |
| `测试.bat` | 跑 JS 自测 + Python 单测（没装 Node 会跳过 JS 部分） |
| `serve.py` | 静态服务 + API 代理（诊断/分析/洛谷） |
| `.env` | 模型 key（`LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`），**不入库** |
| `tools/build-offline.mjs` | 生成离线单文件版（不入库） |

## 仓库与协作现状（2026-11-25）

- 仓库：https://github.com/1sishui/algorithm
- `main` 已开分支保护：**必须 PR + 1 人批准 + CI（tests）通过**，禁止直推和强推
- CI：`.github/workflows/tests.yml`，推 PR 时自动跑，约 15–25 秒
- 协作者：还在加（Settings → Collaborators）
- 网络：本机需开代理（Clash，127.0.0.1:7897）才能访问 GitHub；git 已配全局代理

当前模型：qwen-plus（阿里百炼，OpenAI 兼容接口）。

## 页面结构（左侧导航三页）

1. **可视化**：算法演示（排序/二叉树/图/自定义代码）+ 知识图谱 + 六维评估 + AI 诊断 + 错误诊断
2. **绑定**：洛谷 Cookie 绑定（`__client_id` + `_uid`）
3. **数据**：同步做题情况 / 分析个人情况 + 难度柱状图 + 算法柱状图 + 算法诊断 + 推荐题目

## 关键约定（改之前先想清楚，这些是用户明确要求）

1. **AI 报告里不出现任何分数**，只说强弱、给建议。
2. **绑定后只有两个动作**：同步做题情况（不花钱）、分析个人情况（调用模型）。
3. **没同步过就不能分析个人情况**（按钮禁用 + 代码里二次校验）。
4. **同步时自动抓标签**，不设手动按钮；同步也会自动拉全部记录。
5. **标签只认洛谷 type=2 的算法标签**，年份/比赛来源已在服务端过滤，前端还有一层噪音过滤。
6. **算法图表按大类聚合**（数据结构/图论/动态规划/搜索/数学/字符串/树/计算几何/基础算法），不是细标签。
7. **Cookie 只发给 127.0.0.1**，不落服务端日志，不上传。
8. 执行器/渲染器必须分离：算法只产出 step 数组，渲染器只画。
9. 数字不足时显示 `—`，**绝不编造分数**。

## 代码地图

```
src/
  app.js                 # 装配（最长的文件，注意 el.* 引用要和 index.html 对齐）
  algorithms/            # 执行器：sort/ tree/ graph/
  render/                # 渲染器：arrayBars / treeView / graphView
  knowledge/graph.js     # 知识图谱 12 类 44 点
  knowledge/tagCategories.js # 洛谷标签 → 10 个大类（关键词表）
  assessment/features.js # 六维（运行记录口径）
  assessment/submissions.js # 六维（洛谷口径）
  assessment/diff.js     # 代码行级 diff
  assessment/correction.js # 错误修正质量分析
  import/luogu.js        # 解析洛谷记录
  import/luoguClient.js  # 调本地 API
  ui/verdict.js          # 算法诊断 + 推荐
  agent/report.js        # AI 诊断请求与渲染
server/
  llm_proxy.py           # 模型代理 + 提示词（诊断/分析/代码归类）
  luogu_proxy.py         # 洛谷代理（记录/标签/推荐）
supabase/functions/diagnose/index.ts  # 生产版代理（未部署）
```

## 数据存储（localStorage）

| key | 内容 |
|---|---|
| `algo-agent:submissions` | 洛谷提交记录（含代码、算法标签） |
| `algo-agent:pid-tags` | 每题标签 `{tags, categories, checked}` |
| `algo-agent:luogu-client-id` / `luogu-uid` | 绑定的 Cookie |
| `algo-agent:synced-at` | 上次同步时间（用于分析门禁） |
| `algo-agent:runs` | 本机运行记录（六维运行口径） |
| `algo-agent:usercode` | 用户自定义算法代码 |
| `algo-agent:view` | 上次停留的页面 |

## 踩过的坑（别再踩）

- 洛谷 `/record/list` **没有 Cookie 直接 401**；`_contentOnly=1` 有时返回整页 HTML，要解析 `lentille-context`。
- 洛谷会 302 下发 `C3VK` 防爬 Cookie，必须用 cookie jar 跟随。
- 标签 ID 要查 `/_lfe/tags`（type=2 才是算法标签，4 是年份，3/6 是来源/分类）。
- 洛谷父级树找不到「数据结构」，所以改用本地关键词归并。
- 本地存储 5MB 上限：代码文本容易撑爆，`saveSubmissions` 有瘦身降级。
- 离线打包（`tools/build-offline.mjs`）按 import 拓扑排序，顺序错会白屏。
- Windows 批处理必须 GBK + CRLF，否则打不开。

## 当前状态 / 下一步

见 `BACKLOG.md`。最近在做：洛谷数据链路（同步、标签、诊断、推荐）已通，待做真实用户验证与阈值校准。

## 给新会话的开场白（直接复制）

> 读一下 algo-agent/HANDOFF.md 和 BACKLOG.md，然后我们继续。