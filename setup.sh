#!/bin/bash
set -e

echo "***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***"
echo "  WA CRM v2 一键安装脚本"
echo "***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***"

# 检查 Docker
echo "[1/5] 检查 Docker..."
if ! command -v docker &> /dev/null; then
    echo "Docker 未安装，正在安装..."
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker $USER
    echo "Docker 安装完成"
else
    echo "Docker 已安装"
fi

# 检查 Docker Compose
if ! command -v docker compose &> /dev/null; then
    echo "Docker Compose 未安装，正在安装..."
    sudo apt-get update && sudo apt-get install -y docker-compose
fi

# 克隆代码
echo "[2/5] 克隆代码..."
if [ -d "whatsapp-mgr" ]; then
    echo "代码已存在，更新中..."
    cd whatsapp-mgr && git pull origin main
else
    git clone git@git.k2lab.ai:lets-ai/whatsapp-mgr.git whatsapp-mgr
    cd whatsapp-mgr
fi

# 创建 .env
echo "[3/5] 创建配置文件..."
cat > .env << 'EOF'
# MySQL 数据库
DB_PASSWORD=030319
DB_HOST=mysql
DB_PORT=3306
DB_USER=root
DB_NAME=wa_crm_v2

# OpenAI
OPENAI_API_KEY=***REMOVED***
OPENAI_API_BASE=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o
USE_OPENAI=false

# MiniMax
MINIMAX_API_KEY=***REMOVED***
MINIMAX_API_BASE=https://api.minimaxi.com/anthropic
EOF

# 构建并启动
echo "[4/5] 构建并启动容器..."
docker compose up --build -d

# 完成
echo "[5/5] 完成!"
echo "***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***"
echo "  访问地址: http://localhost:3000"
echo "  停止服务: docker compose down"
echo "  查看日志: docker compose logs -f"
echo "***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***"
