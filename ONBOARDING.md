# 新成员上手（5 步，约 20 分钟）

> 目标：把仓库拉到自己电脑跑起来，然后用 AI 助手（和你现在用的同一个）来改代码。
> 全程不需要你会前端，按步骤做即可。

## 第 0 步：先装两个东西

| 软件 | 用途 | 从哪拿 |
|---|---|---|
| **Python 3**（3.10+） | 跑本地服务（`启动.bat` 依赖它） | python.org 下载，安装时勾选 **Add Python to PATH** |
| **DeepSeek Harness**（AI 助手） | 就是你用来指挥 AI 的那个桌面应用 | 找项目负责人要安装包，**版本要和大家一致** |

装完 Python 后，打开 PowerShell 输入 `python --version`，能显示版本号就行。

## 第 1 步：克隆仓库

```powershell
cd C:\Users\你的用户名\Downloads
git clone https://github.com/1sishui/algorithm.git
cd algorithm
```

没有 Git 的话：装 Git for Windows，或者直接在 GitHub 页面点 **Code → Download ZIP**，解压后进文件夹。

## 第 2 步：配自己的模型 key

仓库里**没有** `.env`（里面有别人的 key，不能提交）。你要自己建一个：

1. 复制 `.env.example`，改名为 `.env`（注意前面有个点，可能被隐藏）
2. 用记事本打开，填：

```
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_MODEL=qwen-plus
LLM_API_KEY=sk-你自己的key
```

3. key 从阿里云百炼（bailian.console.aliyun.com）免费申请，新用户有额度
4. 没有 key 也能跑，只是 AI 诊断不可用（会显示“服务端没配 key”）

> `.env` 已在 `.gitignore` 里，**不会被提交**，放心填。

## 第 3 步：启动

双击 **`启动.bat`**，会弹出黑色窗口并打开浏览器。

窗口里出现这行就成功了：

```
算法学习智能体 · 本地预览  v0.3
```

**黑色窗口别关**，关了网页就打不开。

## 第 4 步：打开 AI 助手，指向这个文件夹

1. 打开 DeepSeek Harness
2. 新建会话，**工作目录选 `algorithm` 这个文件夹**
3. 第一句话复制这段（很重要，让它先读文档）：

```
读一下 HANDOFF.md 和 TASKS.md，然后告诉我项目现在做到哪一步、我该做什么。
```

它会自己读文档、看代码，然后给你派任务。之后你就用中文直接指挥它，比如：

- 「帮我把图算法加上 Dijkstra，照着 traversal.js 的写法」
- 「数据页的柱状图太挤，调一下间距」
- 「跑一遍测试，看看有没有挂的」

## 第 5 步：改完提交

```powershell
git add -A
git commit -m "说明你改了什么"
git pull
git push
```

或者双击 **`上传代码.bat`**（自动提交 + 推送）。

> 推送前先 `git pull`，避免和别人冲突。

---

## 每个人第一次要做的事

1. 跑通 `启动.bat`，三页都能打开
2. 找负责人要一份 `.env` 模板（或自己申请 key）
3. 在 `TASKS.md` 里找到自己的名字，认领本周任务
4. 周五演示前，把自己改的东西 push 上去

## 常见问题

| 现象 | 原因 | 解决 |
|---|---|---|
| 双击 `启动.bat` 一闪而过 | 没装 Python / 没加到 PATH | 重装 Python，勾 Add to PATH |
| 浏览器显示“无法访问” | 黑窗口被关了 | 重新双击 `启动.bat` |
| 页面能开但 AI 诊断报错 | `.env` 没配或 key 无效 | 看黑窗口里 `连接测试：通过/失败` |
| 端口 8123 被占用 | 上次的窗口没关 | 双击 `启动.bat`（会自动关旧的） |
| `git push` 失败 | 没登录 / 没 pull | 重新 push，按提示登录；先 `git pull` |

## 安全红线（四条）

1. **不要**把 `.env` 提交上去（里面有 key）
2. **不要**把洛谷 Cookie 发给任何人（等同账号）
3. **不要**在会话里粘贴别人的 API key
4. 仓库是公开的，**不要**提交个人隐私数据（学号、成绩单等）