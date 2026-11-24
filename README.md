# 算法学习智能体 · 原型 v0.1

面向算法学习的导向型智能体（2026 校级学生科研项目）的第一个可运行版本。

## 多人协作（Git）

代码用 Git 管理。四个人的约定很简单：

| 每天收工 | 双击 `上传代码.bat`（会自动提交并推送） |
| 每天开工 | 先 `git pull` 拉一下别人的改动，再动手 |
| 千万别传 | `.env`（里面有 key，已被 `.gitignore` 排除） |

第一次把仓库放到网上（只需做一次）：

1. 在 GitHub（或 Gitee）上新建一个**空仓库**，名字随意，例如 `algo-agent`，**不要**勾选“初始化 README”
2. 复制仓库地址，在本文件夹打开 PowerShell，执行：

```powershell
git remote add origin https://github.com/你的用户名/algo-agent.git
git push -u origin main
```

3. 弹出登录框就按提示登录一次，之后就不用再输了。

队友第一次拿到代码：

```powershell
git clone https://github.com/你的用户名/algo-agent.git
```

> 提交者信息已经设成「熊廷俊 / xiongtingjun@example.com」，换成自己的真实邮箱只需：
> `git config user.email "你的邮箱"`（只影响这个仓库）。

## 怎么跑（两种方式，任选）

**方式一（最省事）：双击 `算法学习智能体-离线版.html`**

所有代码都打包进这一个文件，不依赖 Python、不依赖网络，双击直接用浏览器打开。
适合给老师、同学演示，也适合拷到 U 盘里带走。

**方式二：双击 `启动.bat`**

它会调用 `serve.py` 起一个本地服务，自动打开 http://127.0.0.1:8123/ 。

> 会弹出一个黑色窗口，那是服务本身，**别关**；关掉网页就打不开了。
> 端口 8123 被占用时，脚本会提示并直接打开已有服务。
> 电脑上没有 Python 时，脚本会自动改用离线版打开。

**两种方式有什么区别**：离线版是打包产物，改了 `src/` 里的源码后需要重新生成（让我来跑 `tools/build-offline.mjs`）；`启动.bat` 直接读源码，改完刷新浏览器就能看到效果，适合开发时用。

## 现在能做什么

- 选择算法（快速排序 / 冒泡排序 / 插入排序 / 二叉树前中后序遍历），生成可视化过程
- 播放、暂停、上一步、下一步、拖进度条、调速度（键盘：空格 / ← / →）
- 自定义输入数组（逗号分隔，最多 60 个元素）
- 树遍历会显示：节点按访问顺序变绿、当前节点高亮、栈里的内容实时更新
- 点左侧知识图谱的节点切换知识点；没有模板的节点会提示“建设中”
- 右侧「错误诊断」：粘贴一段错误代码，返回结构化的诊断结果
- 右侧「理解度评估」：六维演示数据，播放完会小幅变化

## 哪些是真的，哪些是假的

| 模块 | 状态 |
|---|---|
| 执行器 / 渲染器分离 | ✅ 真实实现，后面所有算法照这个套路加 |
| 可视化：数组 / 二叉树 | ✅ 两套渲染器，算法用 `meta.view` 声明用哪个，界面自动切换 |
| 播放器、进度、键盘控制 | ✅ 真实实现 |
| 知识图谱 | 🟡 12 大类已齐，44 个节点（目标 80+），掌握度是假数据 |
| 错误诊断 | ✅ 已接大模型（`serve.py` 代理），无 key / 无网络时自动降级到本地规则，界面会标明来源 |
| 理解度评估 | 🔴 纯演示数字，没有采集任何真实行为数据 |
| 登录 / 云同步 | ⛔ 还没做 |

## 接大模型（诊断面板）

**不配 key 也能用**：诊断走本地 5 条规则，结果右上角标「本地规则」。

要接真模型，三步：

1. **拿 key**（以 DeepSeek 为例）：打开 platform.deepseek.com → 注册登录 → API keys → 创建 → 复制那串 `sk-...`。其他家（通义 / Kimi / 智谱）同理。
2. **填到 `.env`**：把项目根目录的 `.env.example` 复制一份改名为 `.env`，把 key 填进 `LLM_API_KEY=` 后面。
3. **重启服务**：双击 `启动.bat`。窗口里出现 `Key：已配置` 就成功了。

诊断结果右上角会变成 `大模型 · deepseek-chat · 1240 ms`。

- **换模型**：改 `.env` 里的 `LLM_BASE_URL` 和 `LLM_MODEL`，`.env.example` 里写了通义/Kimi/智谱的地址。
- **成本**：一次诊断约 800–1500 token，deepseek-chat 约 0.002–0.005 元/次；1000 元经费够跑很久，日常开发用不到几块钱。
- **安全**：key 只在服务端（`serve.py`）里用，浏览器拿不到；`.env` 已被 `.gitignore` 排除，别提交。
- **上线版**：`supabase/functions/diagnose/index.ts`，部署命令写在文件开头。

### 诊断还是显示「本地规则」怎么办

点诊断面板下面的 **「测试连接」** 按钮，它会直接告诉你卡在哪一环：

| 页面提示 | 原因 | 怎么修 |
|---|---|---|
| 连不上诊断服务 | 服务没启动，或页面是离线版 | 双击 `启动.bat`；确认地址栏是 `127.0.0.1:8123` 而不是 `file://` |
| 诊断服务返回 501 | 端口上跑的是**旧版服务**，没有 `/api/diagnose` 接口 | 双击 `重启服务.bat`（会先杀掉旧进程） |
| Key：未配置 | `.env` 没找到，或文件名写成了 `.env.txt` | 确认 `.env` 就在 `algo-agent` 文件夹里，不是 txt |
| 模型接口报错 401 | key 不对：不是这家的 key，或复制少了几位 | 回平台复制完整 key；DeepSeek 官方 key 是 `sk-` 开头、约 35 位 |
| 模型接口报错 402/429 | 余额不足或被限流 | 充值 / 等一会儿 |
| 连接测试超时 | 网络到不了 api.deepseek.com | 换网络，或在 `.env` 里换 `LLM_BASE_URL` |

> 早期版本用系统默认证书访问 https 会报 `CERTIFICATE_VERIFY_FAILED`，已改为使用 `certifi` 证书包；如果你的环境仍然报错，可以在 `.env` 里临时加一行 `LLM_INSECURE_TLS=1`（仅本机调试，不要提交）。

### 提示 402 Insufficient Balance

这不是代码问题，是**账号余额不足**：key 有效、网络通、请求已经到 DeepSeek 了，只是账户里没钱。两个选择：

1. 充值（DeepSeek 控制台 → 充值，10 元起，本项目一天开发用不到 1 元）；
2. 换一家有免费额度的平台，只改 `.env` 两行，代码不用动：

| 平台 | `LLM_BASE_URL` | `LLM_MODEL` | 说明 |
|---|---|---|---|
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` | 便宜稳定，需充值 |
| 智谱 BigModel | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` | 有免费模型，注册即用 |
| 硅基流动 | `https://api.siliconflow.cn/v1` | `deepseek-ai/DeepSeek-V3` | 新用户送额度 |
| 阿里百炼 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` | 新用户有免费额度 |
| 魔搭 ModelScope | `https://api-inference.modelscope.cn/v1` | `Qwen/Qwen2.5-7B-Instruct` | 每日免费额度 |

> 各家免费额度和模型名会调整，以官网为准。项目经费可以报销 API 费用，记得开发票。

## 诊断质量怎么验证

内置了一个抽检脚本，跑 10 段典型错误代码，自动统计命中率并生成报告：

```
python test/spotcheck.py          # 先启动服务，再另开一个窗口跑
```

最近一次（qwen-plus，2026-11-24）：**10/10 命中，平均 3.2 秒**，明细见 `test/spotcheck_result.md`。

> ⚠️ 这 10 段是**用来调提示词的**，在同一组数据上拿满分不代表泛化能力。
> 正式评估要另建 held-out 集（20–30 段，由不参与调参的同学出题），报告里的数字只认这一份。

调参记录（可直接写进中期材料）：

| 轮次 | 改动 | 结果 |
|---|---|---|
| 初版 | 只给 6 类错误名 | 9/10，二分死循环被判成 boundary |
| 第 2 版 | 加“不收敛属于 logic” | 仍是 9/10，但二分溢出被误判成 none（按下葫芦浮起瓢） |
| 第 3 版 | 三类口径全部写死：boundary=位置 / type=数值 / logic=流程 | 10/10 |

## 目录结构

```
algo-agent/
├─ index.html               # 开发版入口（需要本地服务）
├─ 启动.bat                 # 双击：起服务 + 打开浏览器
├─ 重启服务.bat             # 双击：先杀掉占用 8123 的旧服务，再启动新版
├─ serve.py                 # 本地服务：静态文件 + /api/diagnose 代理
├─ .env.example             # key 配置模板（复制为 .env 使用）
├─ 算法学习智能体-离线版.html  # 打包产物：双击即开，不依赖环境
├─ server/llm_proxy.py      # 大模型代理：提示词、调用、输出收敛、缓存、限流
├─ supabase/functions/diagnose/index.ts  # 生产版代理（部署到 Supabase）
├─ src/
│  ├─ app.js                 # 装配：把下面这些模块串起来
│  ├─ styles.css
│  ├─ core/player.js         # 播放器：只管“第几步”
│  ├─ algorithms/
│  │  ├─ registry.js         # 注册表：加算法只改这里
│  │  ├─ sort/{quick,bubble,insertion}.js   # 执行器：纯函数，产出步骤数组
│  │  └─ tree/{model,traversal}.js          # 二叉树模型与前/中/后序遍历
│  ├─ render/
│  │  ├─ arrayBars.js        # 数组柱状图渲染器
│  │  └─ treeView.js         # 树渲染器（SVG，中序定 x、深度定 y）
│  ├─ knowledge/graph.js     # 知识图谱 + 推荐逻辑
│  ├─ diagnosis/rules.js     # 本地规则（降级用，也是接口参照）
│  ├─ llm/client.js          # 调 /api/diagnose，失败静默降级
│  └─ ui/{mastery,diagnosisPanel}.js
├─ tools/build-offline.mjs   # 重新生成离线版（需要 Node）
├─ test/engines.test.mjs     # 排序执行器自测：300+ 用例
├─ test/tree.test.mjs        # 遍历顺序自测
└─ BACKLOG.md                # 任务看板
```

## 加一个算法要改哪里

1. 在 `src/algorithms/` 下新建文件，导出 `meta` 和 `run(input)`；
2. `run` 返回步骤数组，每步形如：
   ```js
   { array, sorted, pivot, compare: [], swap: [], depth, note, metrics: { comparisons, swaps } }
   ```
3. 在 `registry.js` 里 import 并登记一行。

**UI、播放器、渲染器一行都不用改。**

## 下一步（见 BACKLOG.md）

1. 把可视化从“数组”扩展到树、图、DP 表格（`render/` 下加新渲染器）
2. 用 Edge Function 替换本地规则诊断，接真实大模型
3. 设计 Supabase 表结构，存提交记录与掌握度
4. 写特征计算脚本，把六维数字换成真数据