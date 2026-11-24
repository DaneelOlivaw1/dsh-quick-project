# dsh-quick-project

侧边栏「工作区」右上角的 **+**，现在是一个描述框：**说一句这个项目要做什么，名字由模型取，文件夹建好，新会话开出来，需求已经发出去开始干活。**

原来的路径是：点 + → 目录树里一层层翻到 `~/project` → 新建文件夹 → 返回 → 找出来 → 再把手里的需求重打一遍。这个插件把它压成「打一段话 → 回车」。

**克隆已有项目**也走同一个入口：点「克隆 Git 仓库…」，粘贴地址，克隆到 `~/project/<仓库名>`，**带实时进度**，克隆完自动开工作区、把下面写的需求发出去。

## 长什么样

![描述需求，自动取名](docs/dialog.png)

回车之后：文件夹建好、工作区打开、需求已经发出去。

![已经开干的会话](docs/opened.png)

## 用法

「仓库地址」那一行是**可选的**：填了就克隆，留空就是原来那个「新建空文件夹」。三个字段（需求、仓库地址、项目名）都在同一张卡片里，按下去的那个按钮会跟着变成「创建并开始」或「克隆并开始」。

| 动作 | 结果 |
|---|---|
| 点「+」，描述需求，点「创建并开始」 | 这时才请求模型取名（如 `alipay-bill-summary`）→ 在 `~/project/<名字>` 建目录 → 打开工作区 → 新会话里把需求**发出去** |
| 在「仓库地址」那行粘贴地址，回车 | `git clone --progress` 到 `~/project/<仓库名>`；进度条按 git 自己的阶段走（接收/解析/压缩对象…）；**克隆完成后自动开工作区并发送需求框里写的话** |
| 只填「项目名」、不写需求 | 直接建目录并打开空白会话 |
| 只粘贴仓库地址、不写需求 | 克隆完只打开工作区，不发消息 |
| 名字不满意 | 「项目名」那一栏随时可改，改了就不再被自动覆盖；有仓库地址时留空则用仓库名 |
| 输入一个已存在的名字 | 提示「同名文件夹已存在，将直接打开」→ 打开它，需求照样发出；**但克隆到一个非空目录会被拒绝**（git 不会往已有内容里克隆） |
| `Esc` / 点遮罩 / 取消 | 关闭，什么都不建；**已开始的克隆不会被中断** |
| 「选择已有文件夹…」 | 打开应用内目录浏览（面包屑 + 子目录列表），选中即可用；不依赖宿主的原生选择器 |
| 工作区右键 →「删除项目（含文件夹）」 | 确认后**连磁盘目录一起删**；原来的「删除工作区」只注销登记、留目录 |

`Shift+回车` 换行。

**取名只在按下「创建并开始」（或回车）时发生一次**，打字过程中不发请求、名字栏也不动——名字在你眼前跳来跳去会像是已经动手了。名字栏留空即按需求取名；自己填了就用你填的。

## 命名规则：文件夹名只能是 ASCII

项目名 = 文件夹名 = 一个**小写 ASCII** 路径段：`^[a-z0-9]+(-[a-z0-9]+)*$`，最多 40 字符。

- 中文名会被**明确拒绝**（提示「名称只能用 a-z、0-9 和连字符」），而不是悄悄转拼音或截掉汉字——`账单汇总` 变成空字符串比报错更糟。
- 模型偶尔仍会答中文。这种答案里的汉字**不再**被当作名字返回：命名路由报失败，浏览器侧用 ASCII 兜底（描述里的英文词，或 `project-1124-1536` 这种时间戳名）。
- 规则只有一份：`host/naming.mjs`。命名路由、`/quick-project/create`、克隆路由、浏览器侧都读它，`npm test` 里 `test/naming.test.mjs` 锁住它。

## 三层分别在哪

1. **取名**：宿主侧 `host/name-route.mjs`，`POST /quick-project/name`。用默认模型路由（`agentDefaultModel`）问一句，只取名字：答案里优先抓反引号/引号内的候选，再按「连字符数 + 长度」打分，所以模型回一句 "Here you go: `invoice-reconciler`" 也只会得到 `invoice-reconciler`。模型挂了/路由不通时回 `ok:false`，浏览器侧用本地兜底名，项目照建不误。
2. **建目录 / 克隆 + 开工作区**：建目录走宿主 `POST /quick-project/create`，克隆走 `POST /quick-project/clone`（+ 轮询 `POST /quick-project/clone-status`），工作区的登记与打开交给目录流的所有者（`onPicked`）。

   为什么不调 `directoryPicker.createDirectory`：目录选择器是**组合出来的**——POSIX 上组合出应用内 `browse` 那一半（有 `createDirectory` / `list`），Windows 上组合出原生 `pick`（**只有** `pick`）。哪一半在，取决于平台，所以：
   - 一边是 `createDirectory needs the browse capability; the composed picker serves "native"`（Windows）
   - 另一边是 `directoryPicker.pick needs the native capability; the composed picker serves "browse"`（POSIX）

   两种情况本插件都遇到过。现在建目录、列目录、删除、**克隆**全部走宿主（`host/project-fs.mjs`、`host/clone-route.mjs`），宿主既知道真实路径分隔符，也永远有文件系统和子进程，不再依赖哪一半被组合出来。
3. **把需求发出去**：`startSession(workspaceId, { prompt })` 只**填草稿**不发；`AutoSendGuard` 挂在 `conversation.input.left`，等它自己那个会话的草稿变成刚写进去的文字，再 `inputActions.submit()` 一次。新建和克隆**共用这一段**：克隆完成也是拿到目录后调同一个 `finishWith`。

「选择已有文件夹…」走的是 `listDirectory`（`browse` 能力），**不用** `directoryPicker.pick`：后者需要宿主的 `native` 能力，而用应用内选择器组装的部署只提供 `browse`，调过去会直接报 “needs the native capability”。

## 克隆的进度是怎么来的

`git clone --progress` 把进度写在 **stderr**，且用 `\r` 覆盖同一行。宿主把它逐行解析成 `{ phase, percent, line }`：

- `phase` 来自 git 自己的标签（`Receiving objects` → `receiving`，`Resolving deltas` → `resolving`，还有 `counting` / `compressing` / `enumerating` / `starting`），对话框把这几个词翻译成人话；
- `percent` 取那一行的数字，**按阶段各自递增**：同一阶段内只增不减，换阶段则从该阶段自己的读数重新开始。早先的实现做的是全局取最大值，结果 `Resolving deltas` 从 0% 起数时进度条被死死钉在前一阶段的 100%，看着像卡死；
- **`remote:` 开头的行不算进度**。`remote: Compressing objects: 100%` 是对端（服务器）压缩完了，不是这次克隆完成了 100%——把它算进去会让进度条在真正下载时一直停在 100%。这类行只作为原始文本显示，不参与百分比；
- `starting` / `counting` / `enumerating` / `compressing` 这几个阶段 git **不给百分比**。此时进度条切成扫动的不确定态，状态行也只写阶段名，而不是假装「0%」——一个冻在 2% 的进度条会被读成卡死；
- 跨 chunk 被切断的行会先缓存再拼，不会读半行。

克隆**在宿主后台跑，不占着 HTTP 响应**，所以大仓库不会把请求挂死；对话框关掉克隆也继续，下次打开同一个工作区就是它的结果。失败时**自动删掉半成品目录**，免得下次被当成已存在的工作区打开。

`git` 不在 PATH 上会明确报「git is not installed, or not on the Host PATH」，而不是静默失败。

## 删掉建错的项目

Harness 自带的「删除工作区」只注销登记，文件夹留在磁盘上——建错了就没有下文了。所以工作区右键菜单里多一项**「删除项目（含文件夹）」**：确认框里写明名字和完整路径，确认后先注销工作区、再 `POST /quick-project/remove` 递归删目录。

![工作区菜单里的删除项](docs/delete-menu.png)

删除端点的护栏（都在 `host/remove-route.mjs`，有测试）：

- 只删宿主 home 之内的路径（分隔符按平台，Windows 的 `\\` 也算）；
- 不删 home 本身、不删 `/`；
- 不删项目根 `~/project`（一次点错不该清空所有项目）；
- 不删 `~/.dsh` 里面任何东西（会话就在那儿）；
- 必须是已存在的目录，符号链接按真实落点判断。

## 回车不会误建

输入法选词时按的回车也会触发 `keydown`，被当成「提交」就会建出一个没人确认过的项目。描述框和名字框都跳过了组词状态的回车（`isComposing` / `keyCode 229`）。

## 它接管了什么

Harness 的目录流插槽 `sidebar.workspaces.directoryFlow`（以及空状态那个 `conversation.hero.workspace.directoryFlow`）声明为 `single`，按 priority 升序取第一个渲染。官方目录选择器在 priority `0`，本插件注册在 `**-1**`，所以是它渲染；官方那个仍然活着，通过「选择已有文件夹…」可达。

## 安装

```bash
dsh plugin install github:DaneelOlivaw1/dsh-quick-project#main
```

### 本地开发时最容易踩的坑：装了不等于跑你改的那份

用 `file:` 依赖本地开发时，profile 里 `node_modules/dsh-quick-project` 是**一份拷贝**，不是指向工作树的符号链接。所以：

- 改工作树里的 `host/*.mjs` / `client/src/client.js`，**宿主毫无感知**——它加载的是 profile 下那份旧拷贝；
- 重启也不会变，因为那份拷贝还是旧的；
- 表现就是「我明明改了、测试也过了，界面上却还是老行为」，而且看不出任何报错。

必须把新代码装进 profile 再重启：

```bash
cd ~/.dsh/profiles/web
pnpm add "file:/Users/daneel/project/dsh-quick-project"   # 重新拷贝
# 然后重启宿主
```

`pnpm install` 不够：`file:` 依赖的 lock 哈希没变时它会说 "Already up to date"，什么都不做。`rm -rf node_modules/dsh-quick-project && pnpm install` 也不够（同样判定已是最新，还可能什么都不装回来）。要用 `pnpm add`。

auto 取名还需要把宿主的取名路由挂上。它单独成模块，是因为 **Node 按 URL 缓存 ESM**：改插件主模块只有重启宿主才生效，而进程没导入过的路径会在 recompose 时被加载。所以在 profile 的 `cordis.patch.yml` 末尾加：

```yaml
- insert:
    - id: quick-project-routes
      name: file:///Users/daneel/project/dsh-quick-project/host/routes.mjs?v=1
```

`host/routes.mjs` 一个入口挂全部路由（取名、建/列/删目录、克隆与克隆进度），所以补丁只需一条。

普通安装**不需要**这一段：插件主模块（`index.mjs` → `host/routes.mjs`）在每次宿主启动时会把全部路由挂上。补丁条目只为一件事——让**已经在跑**的宿主立刻拿到新路由（改了 `host/*.mjs` 之后不用重启）。路由模块自己会先释放旧路由再挂新的，所以 `?v` 加一就是一次热替换，不会撞重复注册。

`?v=N` 是给宿主内部用的版本号：改了对应的 `host/*.mjs`，把它 +1，宿主 recompose 时就会导入新代码并替换旧路由（不 +1 会命中 ESM 缓存，跑的还是旧逻辑）。

**热替换条目的生命周期有个坑**：这条 insert 一旦被注释掉或删除，recompose **会卸载它挂载的路由**，而启动时主模块挂的那份早已被它替换掉了——于是运行中的宿主一条 quick-project 路由都不剩（`/quick-project/*` 落到 SPA 兜底，新建对话框直接报错）。所以撤掉热替换的正确做法是**重启宿主**（主模块会重新挂上），而不是把条目注释掉；或者把 `?v` 再 +1 保持插件仍被挂载，下次启动交给主模块。

**第二个坑，更隐蔽**：`?v=N` 只给入口模块换了 URL，**不会传给它内部的 `import`**。Node 按解析后的完整 URL 缓存模块，所以 `routes.mjs?v=10` 里一句静态的 `import './clone-route.mjs'` 仍然解析成裸路径，命中的是**第一次加载**缓存的那份。结果就是 `?v` 加了、入口换了新实例，而每条路由都还在跑旧代码——改完代码发现"没生效"，看着像热替换坏了，其实是子模块从没被替换过。

现在 `host/routes.mjs` 用 `importSibling()` 把自己的 `?v` 拼到子模块 URL 上，所以**一次 bump 等于整个路由集真正重载**。如果你新增了 `host/*.mjs` 路由模块，记得也用 `importSibling('./your-route.mjs')` 加载（别写静态 import），否则会重新踩这个坑。

还有一点：**改完 `host/*.mjs` 后 bump `?v` 不一定立刻生效**——cordis 不监视 patch 文件，取决于宿主何时 recompose。最可靠的验证方式是重启宿主。


## 开发

```bash
node scripts/build.mjs                          # 重建 client/client.js
DSH_QUICK_PROJECT_DEBUG=1 node scripts/build.mjs # 不压缩
npm test                                        # 命名规则 + 取名/克隆/目录路由的契约
```

改 `client/src/client.js` 后必须重建：宿主下发的是 `client/client.js` 这个打包产物。React 保持外置（loader 的 require 表持有它，打进包里会出现第二份副本并破坏 hooks）。`host/naming.mjs` 会被打进客户端产物（两边共用一份规则），所以改它也要重建。

文案在 `client/src/client.js` 顶部的 `LABELS`（zh/en）。项目根目录是宿主 home 下的 `project/`。

## 已知取舍

- 「+」弹出的是对话框，不是常驻在侧栏里的输入框：那一行（搜索/排序/+）官方没有开放 slot，硬塞只能靠 DOM 注入，且 280px 的侧栏塞不下三个图标加输入框。
- 需求发出后模型会立刻开始干活。名字没取好时先改名字再回车，比事后重命名工作区便宜。
- 克隆是**「clone 完就开」**：不探测仓库结构（没有根 `package.json` 也不会问）、不装依赖、不切分支。
- 地址支持 `https://`、`ssh://`、`git@host:owner/repo`、`file:///…` 和本地路径。私有库要宿主环境里已有凭据：`GIT_TERMINAL_PROMPT=0`，不会弹交互式登录，缺凭据会直接失败。
- 中文名是**拒绝**而不是转拼音。想用拼音得自己拼好填进名字栏（`zhangdan-huizong`），规则不替你做语言转换。
