# dsh-quick-project

侧边栏「工作区」右上角的 **+**，现在是一个输入框：**打一个名字，回车，文件夹就在 `~/project` 下建好并打开成工作区**。

原来的路径是：点 + → 目录树里一层层翻到 `~/project` → 新建文件夹 → 返回 → 再把它找出来。四步，而唯一的信息量只有一个名字。这个插件把四步压成「点 + → 打名字 → 回车」。

## 用法

| 动作 | 结果 |
|---|---|
| 点「+」，输入名称，回车 | 在 `~/project/<名称>` 建目录，并打开该工作区（带一个空白会话） |
| 输入一个已存在的名字 | 提示「同名文件夹已存在，将直接打开」，回车即打开，不报错 |
| `Esc` / 点遮罩 / 取消 | 关闭，什么都不建 |
| 「选择已有文件夹…」 | 退回宿主原生目录选择器（不丢失原来的选择能力） |

名称必须是单个路径段：不能为空，不能含 `/` 或 `\`。

创建目录、登记工作区、开新会话都由宿主完成（浏览器碰不到文件系统），插件只负责那个输入框。

## 它接管了什么

Harness 的目录流插槽 `sidebar.workspaces.directoryFlow`（以及空状态那个 `conversation.hero.workspace.directoryFlow`）声明为 `single`，按 priority 升序取第一个渲染。官方目录选择器在 priority `0`，本插件注册在 `**-1**`，所以是它渲染；官方那个仍然活着，通过「选择已有文件夹…」可达。

这也解释了为什么这个插件的宿主编包必须存在却几乎为空：真正的调用（`directoryPicker.createDirectory`、`workspaces.create`）都是客户端已有的 remote，宿主侧没有新逻辑。

## 安装

```bash
# 已在 ~/.dsh/profiles/web 里用 file: 依赖注册（plugin_manager 完成）
dsh plugin list
```

手动注册等价于在 profile 的 `package.json` 里加：

```jsonc
"dependencies": { "dsh-quick-project": "file:/Users/daneel/project/dsh-quick-project" },
"dsh": { "profile": { "bundles": ["…", "dsh-quick-project"] } }
```

装完刷新页面（客户端插件随 boot manifest 下发）。

## 开发

```bash
node scripts/build.mjs          # 重建 client/client.js
DSH_QUICK_PROJECT_DEBUG=1 node scripts/build.mjs   # 不压缩，便于读堆栈
```

改 `client/src/client.js` 后必须重建：宿主下发的是 `client/client.js` 这个打包产物，不是源码。React 保持外置（loader 的 require 表持有它，打进包里会出现第二份副本并破坏 hooks）。

文案在 `client/src/client.js` 顶部的 `LABELS`（zh/en）。项目根目录是宿主 home 下的 `project/`，想改就改 `root` 那一行。
