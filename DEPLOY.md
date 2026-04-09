# WA CRM v2 部署指南

> 供 AI Agent 和开发人员阅读的标准化部署流程。

---

## 快速部署（Docker）

### 前置条件
- Docker & Docker Compose 已安装
- 项目 SSH 已配置（参考下方 SSH 配置）

### 部署步骤

```bash
# 1. 克隆项目
git clone git@git.k2lab.ai:319reinforce/wa-crm-v2-for-k2.git
cd wa-crm-v2

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，填入必要的 API Keys

# 3. 启动（包含 MySQL）
docker compose up -d

# 4. 验证服务
curl http://localhost:3000/api/health
```

### 停止
```bash
docker compose down        # 停止服务
docker compose down -v     # 停止并删除数据卷（慎用）
```

---

## 本地开发部署（Node.js）

### 前置条件
- **Node.js** ≥ 18（测试环境 v24）
- **MySQL** 8.x 或 9.x
- 项目 SSH 已配置

### 环境要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | ≥ 18 | 推荐 v20 LTS |
| MySQL | 8.x / 9.x | 数据库 |
| npm | ≥ 9 | 包管理器 |

### 部署步骤

```bash
# 1. 克隆项目
git clone git@git.k2lab.ai:319reinforce/wa-crm-v2-for-k2.git
cd wa-crm-v2

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env.example .env
# 填入以下必填项：
#   - DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME
#   - OPENAI_API_KEY（或 MINIMAX_API_KEY）

# 4. 创建数据库（MySQL CLI）
mysql -h <DB_HOST> -u root -p < schema.sql
# 或手动执行：
#   CREATE DATABASE wa_crm_v2 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

# 5. 启动服务
npm start
# 服务地址：http://localhost:3000

# 6. 验证
curl http://localhost:3000/api/health
# 期望返回：{"status":"ok",...}
```

---

## 环境变量说明

### 必填项

| 变量 | 说明 | 示例 |
|------|------|------|
| `DB_HOST` | MySQL 主机 | `127.0.0.1` |
| `DB_PORT` | MySQL 端口 | `3306` |
| `DB_USER` | 数据库用户名 | `root` |
| `DB_PASSWORD` | 数据库密码 | `your_password` |
| `DB_NAME` | 数据库名 | `wa_crm_v2` |
| `OPENAI_API_KEY` | OpenAI API Key（USE_OPENAI=true 时必填） | `sk-...` |

### 选填项

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `USE_OPENAI` | `false` | 是否使用 OpenAI（false 则用 MiniMax） |
| `OPENAI_API_BASE` | `https://api.openai.com/v1` | OpenAI API 地址 |
| `OPENAI_MODEL` | `gpt-4o` | OpenAI 模型 |
| `MINIMAX_API_KEY` | - | MiniMax API Key |
| `MINIMAX_API_BASE` | `https://api.minimaxi.com/anthropic` | MiniMax API 地址 |

### Vite 前端变量（自动生效）

前端构建时读取 `VITE_` 前缀的同名变量，无需额外配置。

---

## 数据库 Schema

完整 Schema 定义在 `schema.sql`，核心表：

| 表名 | 用途 |
|------|------|
| `creators` | 达人主表（wa_phone 唯一标识） |
| `creator_aliases` | 达人别名映射 |
| `wa_messages` | WA 对话消息 |
| `sft_memory` | SFT 训练语料 |
| `sft_feedback` | Skip/Reject/Edit 反馈 |
| `client_memory` | 客户单独记忆 |
| `client_profiles` | 客户独立画像 |
| `client_tags` | 动态标签 |
| `policy_documents` | 政策文档 |
| `operator_experiences` | Experience Router 配置 |
| `audit_log` | 操作审计日志 |

### 字符集
- 数据库：`utf8mb4_unicode_ci`
- 所有表：`utf8mb4`，支持 emoji

---

## 目录结构

```
wa-crm-v2/
├── server/             # 后端入口（Node.js）
│   └── index.cjs       # 主服务（注意 .cjs 扩展名）
├── src/                # 前端 React 代码
├── agents/             # Agent 逻辑
├── routes/             # Express 路由
├── schema.sql          # 数据库 Schema
├── package.json        # 依赖定义
├── vite.config.js      # Vite 构建配置
├── docker-compose.yml  # Docker 部署配置
├── Dockerfile          # Docker 镜像
├── .env                # 环境变量（不上传 git）
├── .env.example        # 环境变量模板
├── CLAUDE.md           # AI Agent 入口
├── BOT_INTEGRATION.md  # API 集成说明
├── SFT_PROJECT.md      # SFT 训练系统说明
├── CODE_REVIEW.md      # 代码审查清单
└── DEPLOY.md           # 本文档
```

---

## 故障诊断

```bash
# 1. 服务健康检查
curl http://localhost:3000/api/health

# 2. MySQL 连接
mysql -h 127.0.0.1 -u root -p -e "SELECT 1"

# 3. 查看进程
ps aux | grep node | grep -v grep

# 4. 查看日志
cat /tmp/server.log

# 5. 重启服务
pkill -f "node.*server" && node server/index.cjs > /tmp/server.log 2>&1 &
```

---

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 服务健康检查 |
| GET | `/api/creators` | 达人列表 |
| GET | `/api/creators/:id` | 达人详情 |
| PUT | `/api/creators/:id` | 更新达人 |
| GET | `/api/audit-log` | 操作审计 |
| POST | `/api/experience/route` | Experience Router |
| GET | `/api/sft-memory` | SFT 语料 |
| POST | `/api/sft-memory` | 创建 SFT 语料 |

完整 API 文档见 `BOT_INTEGRATION.md`。

---

## SSH 配置

部署机器需要配置 SSH Key 访问 `git.k2lab.ai`：

```bash
# 1. 生成 SSH Key（如果还没有）
ssh-keygen -t ed25519 -C "your_email@example.com"

# 2. 查看公钥
cat ~/.ssh/id_ed25519.pub

# 3. 添加到 git.k2lab.ai
#    Settings → SSH Keys → 添加公钥

# 4. 验证连接
ssh -T git@git.k2lab.ai
```

---

## 常见问题

**Q: 端口 3000 被占用？**
```bash
lsof -i :3000 | grep LISTEN
# 杀进程或改 .env 中的端口
```

**Q: MySQL 连接失败？**
- 确认 MySQL 服务运行中
- 确认 `DB_PASSWORD` 正确
- 确认用户有 `wa_crm_v2` 数据库权限

**Q: 前端白屏？**
```bash
# 检查 API 是否正常
curl http://localhost:3000/api/health
# 检查 MySQL 连接
mysql -h 127.0.0.1 -u root -p -e "SHOW TABLES;"
```
