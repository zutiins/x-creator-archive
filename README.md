# X Creator Vault

一个用于本地保存、浏览与管理 X（Twitter）创作者资料的深色画廊应用。

> 本项目仿照「女菩萨项目」创建。

应用将创作者资料保存到本地 JSON 数据库，提供前台画廊与管理后台；可对重点关注账号进行低频资料与最新推文同步。

## 功能

- 游客 / 私密双模式：游客仅能浏览“推荐”分类；通过管理密码验证后可查看完整内容。
- 深色画廊前台：搜索、排序、分类筛选、随机精选与创作者详情。
- 移动端适配：详情页全屏展示，适合手机管理和浏览。
- 管理后台：新增、编辑、隐藏、删除创作者；管理分类、账号状态与重点关注。
- 重点关注同步：同步重点账号资料和最新推文，具有随机延迟、失败回退和同步历史记录。
- 本地存档：账号失效、注销或封禁后可保留历史资料并归入“赛博坟场”。

## 环境要求

- Node.js 20 或更高版本
- npm

## 安装与启动

```bash
# 安装依赖
npm install

# 创建管理密码文件（请替换为至少 8 位的强密码）
echo "********" > .admin-password

# 创建本地运行配置
cp data/settings.json.example data/settings.json

# 启动服务
npm start
```

默认仅监听本机：`http://127.0.0.1:39090`

## 配置

| 文件 | 用途 | 是否应提交到 Git |
|---|---|---:|
| `.admin-password` | 管理后台密码 | 否 |
| `.env` | 本地环境变量、可选 X 凭据 | 否 |
| `data/settings.json` | 本地站点和代理配置 | 否 |
| `data/settings.json.example` | 配置模板 | 是 |
| `data/creators.json` | 创作者资料库 | 否 |
| `data/lists.json` | 分类数据 | 否 |
| `data/sync-history.json` | 同步运行记录 | 否 |

`.env.example` 与 `data/settings.json.example` 中使用 `***` / `********` 作为占位符。实际密码、Cookie、Token、代理账号和代理密码只应写在本机被忽略的文件中。

## 项目结构

```text
src/       Node.js 服务端与 API
public/    前台与后台静态资源
scripts/   重点关注账号同步脚本
data/      本地运行数据（默认不纳入 Git）
import/    导入用原始文件（默认不纳入 Git）
```

## 同步机制

`scripts/sync-watch-tweets.mjs` 只处理 `watchEnabled=true` 的账号：

1. 刷新创作者公开资料；
2. 获取最新推文与媒体信息；
3. 每个账号之间随机等待 3–8 秒；
4. 连续失败 3 次时提前停止；
5. 将同步结果保存至本地同步历史。

同步脚本仅应以低频、只读方式运行。网站访客请求只读取本地数据，不会触发对 X 的实时请求。

## 安全与隐私

- `.gitignore` 已排除密码、环境变量、真实数据、导入文件、运行日志和依赖目录。
- 不要使用 `git add -f` 强制提交被忽略的文件。
- 不要在源码、测试文件、Issue、Pull Request 或 Actions 日志中粘贴 X Cookie、Token、代理凭据或管理员密码。
- 在公开仓库前，执行 `git status --ignored` 与 `git diff --cached` 检查待提交文件。
- 建议使用 GitHub 的 noreply 提交邮箱，避免公开个人邮箱。

## 许可证

版权所有。除非获得作者明确书面许可，否则不得复制、分发、部署或用于商业用途。
