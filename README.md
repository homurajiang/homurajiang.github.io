# 羽毛球对阵生成器

智能匹配 · 公平对战 · 一键分享。纯前端 + Cloudflare Workers KV，免运维。

## 功能

- **随机双打**：自动生成双打对阵，保证每人对局数一致。
- **混合双打**：支持男女人数不等的场景，自动放松配对约束（不出现男双 vs 女双）。
- **单打轮转**：单打循环赛模式。
- **连续出场优化**：默认重排对局顺序，使任一选手连续出场不超过 3 场（兼顾体力）。
- **实时统计**：比分录入、胜负排名、净胜分统计。
- **比赛分组**：支持 12 支双打队伍按队伍等级随机均衡分为 A/B 两组，并展示小组赛与淘汰赛规则。
- **云同步分享**：点一下"开启云同步并分享"就把比赛存到云端并拿到分享链接；之后的改动自动同步。
- **比赛历史**：首页"查看比赛历史"集中管理所有你开启过云同步的比赛。
- **响应式设计**：适配手机和桌面端。

## 页面入口

```
index.html       ← 着陆页：三个大入口
  ├── generate.html  ← 生成新对阵
  ├── history.html   ← 查看比赛历史
  └── tournament.html ← 12 队比赛分组

result.html      ← 对阵结果页（三种角色：local / owner / viewer）
```

## 文件结构

```
/
├── index.html              # 着陆页
├── generate.html           # 对阵生成器
├── history.html            # 比赛历史列表（从 KV 拉取）
├── tournament.html         # 12 队分组工具（含赛制规则与 KV 分享）
├── result.html             # 对阵结果页（含分享、云同步、访客视图）
├── js/
│   ├── matching.js         # 匹配算法 + 连续出场约束重排
│   ├── lz-string.min.js    # URL 压缩（分享快照用）
│   └── share.js            # 分享/云同步模块
├── cloudeflare_kv/
│   ├── worker.js           # Cloudflare Worker（KV REST API）
│   └── test.sh             # 接口调用示例
├── .nojekyll
└── vercel.json             # Vercel 部署配置（可选）
```

## 连续出场约束算法

为了减轻体力负担，`Matching.generate()` 之后会对对局顺序做一次重排，目标是让任一选手的连续出场数 ≤ 3。

算法为"贪心 + 2-opt 修复"：

1. **贪心阶段**：每次从剩余对局里选一个"放进去不会让任何选手连续出场 > 3"的候选。若死锁则任选一个推进。
2. **2-opt 修复**：若仍存在违规窗口，尝试把违规位置与后面首个"不含同一人"的对局对换，最多 50 次迭代。

实测：典型 6~12 人、12~20 场的场景，100 次随机试验均能满足 ≤3 约束。4 人 k=8 这种数学不可避免的极端情况算法会"尽力"但仍返回违规结果。

点击"重排对局顺序"按钮可以再跑一次。

## 分享与云同步

### 角色

| 角色 | 进入条件 | 能力 |
|------|---------|------|
| **Local** | 从 `generate.html` 生成后到达 `result.html`（无 `#id`） | 全部编辑；点"开启云同步并分享"可保存到云端历史 |
| **Owner** | 打开自己创建的 `#id=xxx` 链接（本地 `localStorage` 标记过所有权） | 与 Local 一致；编辑自动 2.5s debounce 后同步到云端 |
| **Viewer** | 打开他人创建的分享链接 | 只读；有 `id` 时每 20s 自动轮询更新 |

### 链接格式

- 纯快照：`result.html#d=<LZString 压缩数据>`
- 云同步：`result.html#id=<短ID>&d=<快照>`（`d` 作为云端不可达时的兜底）

### 后端（Cloudflare Worker + KV）

- REST 接口：`GET / PUT / DELETE  /bad_match/<id>`
- 分组记录：`GET / PUT / DELETE /badminton_tournament/<id>`
- 鉴权：`x-api-key` header
- Key 白名单：仅 `bad_match/[a-z0-9]{6,32}`、`badminton_tournament/[a-z0-9]{6,32}` 格式
- 请求体上限：100 KB
- 部署：进入 `cloudeflare_kv/` 后 `wrangler deploy`（需先在 Cloudflare 控制台：绑定 KV namespace 为 `STORAGE`，设置 `API_KEY` secret）

### 免费额度说明

Cloudflare KV 免费档：读 100k/天，写 1k/天，存储 1GB。
debounce 设为 2.5s，正常使用一场比赛写入量通常在 10~30 次左右。

## 部署

### GitHub Pages
1. 推送到 GitHub 仓库。
2. Settings → Pages，Source 选 `main` 分支、`/ (root)` 目录。
3. 保存等待部署。

### Vercel
直接导入仓库即可。

## 数据安全 & 隐私

- "我的历史"仅保存在本机 `localStorage` 里，没有账号概念——换浏览器/设备后不可见，但 KV 云端数据仍在（可通过分享链接再次访问）。
- API Key 是前端公开的；Worker 侧以 key 前缀白名单 + 体积上限做了基本防护。
