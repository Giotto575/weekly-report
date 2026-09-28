# 腾讯文档周报看板 · GitHub 免费版

这个版本不使用 Vercel、CloudBase、本地 Excel 或自建服务器。

数据链路：

**腾讯文档在线表格 → GitHub Actions → `data/data.json` → GitHub Pages 网页**

GitHub Actions 默认每 5 分钟读取一次腾讯文档；也可以在 Actions 页面手动执行一次同步。

## 已按你的表格固定的列映射

- A：年份
- B：例会时间（读取但网页不显示）
- C：月份
- D：具体周（例如 `11.17-11.23`）
- E:R：周一到周日考勤，共 14 列（上午/下午）
- S：月度计划
- T：本周完成情况
- U：所遇到的问题
- V：下周工作计划

当前默认把腾讯文档里的**每一个工作表 Tab 当作一个人员**，工作表标题就是人员名称。

## 你只需要做 6 步

### 1. 创建 GitHub 仓库

登录 GitHub，点击右上角 `+` → `New repository`。

建议仓库名：

`weekly-report`

选择：

- `Public`
- 不勾选 README 初始化（因为本项目已经带 README）

然后点击 `Create repository`。

### 2. 上传本项目全部文件

进入新仓库 → `Add file` → `Upload files`。

把这个 ZIP 解压后的**所有文件和文件夹**上传，包括隐藏目录 `.github`。

最终至少应该看到：

```text
.github/workflows/sync.yml
scripts/sync.mjs
data/data.json
index.html
config.json
.nojekyll
README.md
```

### 3. 获取腾讯文档 Token

打开腾讯文档官方 Token 页面：

https://docs.qq.com/open/auth/mcp.html

登录腾讯文档账号并获取 Token。

**不要把 Token 写进任何仓库文件，也不要把 Token 发给其他人。**

### 4. 把 Token 保存到 GitHub Secret

在你的 GitHub 仓库中打开：

`Settings` → `Secrets and variables` → `Actions` → `New repository secret`

Name 填：

`TENCENT_DOCS_TOKEN`

Secret 填刚刚复制的腾讯文档 Token，然后保存。

### 5. 第一次手动同步

进入仓库顶部：

`Actions` → 左侧选择 `同步腾讯文档` → `Run workflow` → 再点绿色 `Run workflow`

等待运行成功。

运行成功以后，仓库里的 `data/data.json` 会出现腾讯文档中的在线数据。

### 6. 开启 GitHub Pages

打开：

`Settings` → `Pages`

在 `Build and deployment` 中设置：

- Source：`Deploy from a branch`
- Branch：`main`
- Folder：`/(root)`

点击 `Save`。

之后 GitHub 会生成类似这样的公开网址：

`https://你的GitHub用户名.github.io/weekly-report/`

## 人员筛选

默认自动读取所有工作表 Tab。如果某些 Tab 不是人员，例如“说明”“汇总”，可以修改 `config.json`：

```json
{
  "fileId": "DUXNBVnVMTG5tb1RH",
  "range": "A1:V450",
  "includeSheets": [],
  "excludeSheets": ["说明", "汇总"]
}
```

如果只希望显示指定人员，可用：

```json
"includeSheets": ["张三", "李四"]
```

## 关于同步频率

`.github/workflows/sync.yml` 当前设置为约每 5 分钟执行一次。GitHub 的定时任务不是严格准点，高负载时可能延迟。

网页自身每 60 秒检查一次 GitHub Pages 上是否出现了新的 `data.json`，但网页上的“刷新数据”按钮**不会直接启动腾讯文档同步**；它只是立即重新读取最近一次 GitHub Actions 已同步的数据。

另外，GitHub 官方说明：公共仓库如果连续 60 天没有仓库活动，定时 workflow 可能会被自动停用。实验室周报正常每周更新时通常不会遇到；如果长期停用后恢复使用，到 Actions 页面重新启用并手动 Run workflow 即可。

## 公开数据提醒

这是公开网页 + 公开 GitHub 仓库方案。同步后的 `data/data.json` 也是公开可访问的，因此请只同步允许公开展示的人员、考勤和周报内容。

Token 本身不会写进 `data.json`，它只保存在 GitHub Actions Secret 中。
