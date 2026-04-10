#!/bin/bash
set -e
set -u

echo "***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***"
echo "  WA CRM v2 全自动安装脚本"
echo "  支持 macOS / Ubuntu / Debian"
echo "***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 检测系统
detect_os() {
    if [[ "$OSTYPE" ***REMOVED*** "darwin"* ]]; then
        echo "macOS"
    elif [[ -f /etc/debian_version ]]; then
        echo "Debian/Ubuntu"
    elif [[ -f /etc/redhat-release ]]; then
        echo "CentOS/RHEL"
    else
        echo "Unknown"
    fi
}

# ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 1. 安装 Git ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
install_git() {
    log_info "[1/7] 检查 Git..."
    if command -v git &> /dev/null; then
        log_info "Git 已安装: $(git --version)"
    else
        log_warn "Git 未安装，正在安装..."
        OS=$(detect_os)
        if [[ "$OS" ***REMOVED*** "macOS" ]]; then
            if command -v brew &> /dev/null; then
                brew install git
            else
                log_error "请先安装 Homebrew: https://brew.sh"
                exit 1
            fi
        else
            sudo apt-get update && sudo apt-get install -y git
        fi
        log_info "Git 安装完成: $(git --version)"
    fi
}

# ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 2. 安装 Docker ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
install_docker() {
    log_info "[2/7] 检查 Docker..."
    if command -v docker &> /dev/null; then
        log_info "Docker 已安装: $(docker --version)"
    else
        log_warn "Docker 未安装，正在安装..."
        OS=$(detect_os)
        if [[ "$OS" ***REMOVED*** "macOS" ]]; then
            if command -v brew &> /dev/null; then
                brew install --cask docker
            else
                log_error "请先安装 Homebrew: https://brew.sh"
                exit 1
            fi
        elif [[ "$OS" ***REMOVED*** "Debian/Ubuntu" ]]; then
            curl -fsSL https://get.docker.com | sh
            sudo usermod -aG docker $USER
        else
            log_error "不支持的操作系统，请手动安装 Docker"
            exit 1
        fi
        log_info "Docker 安装完成"
    fi

    # 启动 Docker（macOS 需要手动启动）
    OS=$(detect_os)
    if [[ "$OS" ***REMOVED*** "macOS" ]]; then
        if pgrep -x "Docker" &> /dev/null; then
            log_info "Docker Desktop 已运行"
        else
            log_warn "请启动 Docker Desktop 后按回车继续..."
            read -p "或直接运行 'open -a Docker' 启动"
        fi
    fi

    # 等待 Docker 准备好
    local retries=30
    while ! docker info &> /dev/null; do
        ((retries--))
        if [[ $retries -eq 0 ]]; then
            log_error "Docker 启动失败"
            exit 1
        fi
        sleep 1
    done
    log_info "Docker 运行正常"
}

# ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 3. 配置 SSH Key ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
setup_ssh() {
    log_info "[3/7] 检查 SSH Key..."

    # 检查是否有 SSH Key
    if [[ -f ~/.ssh/id_ed25519.pub ]]; then
        log_info "SSH Key 已存在"
    elif [[ -f ~/.ssh/id_rsa.pub ]]; then
        log_info "SSH Key 已存在"
    else
        log_warn "SSH Key 不存在，正在生成..."
        ssh-keygen -t ed25519 -C "jiaweiyan@moras.ai" -f ~/.ssh/id_ed25519 -N ""
        log_info "SSH Key 生成完成"
    fi

    # 显示公钥
    log_info "您的 SSH 公钥："
    cat ~/.ssh/id_ed25519.pub 2>/dev/null || cat ~/.ssh/id_rsa.pub
    echo ""
    log_warn "请将上面的公钥添加到 K2Lab: https://git.k2lab.ai/-/user_settings/ssh_keys"
    echo ""
    read -p "添加完成后按回车继续... "
}

# ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 4. 克隆/更新代码 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
clone_repo() {
    log_info "[4/7] 克隆代码仓库..."

    if [[ -d "whatsapp-mgr" ]]; then
        log_info "代码已存在，更新中..."
        cd whatsapp-mgr
        git pull origin main
    else
        git clone git@git.k2lab.ai:lets-ai/whatsapp-mgr.git whatsapp-mgr
        cd whatsapp-mgr
    fi

    log_info "代码准备完成"
}

# ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 5. 配置环境变量 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
setup_env() {
    log_info "[5/7] 配置环境变量..."

    if [[ -f .env ]] && [[ -s .env ]]; then
        log_warn ".env 已存在，跳过创建"
        log_info "如需修改，请手动编辑 .env 文件"
    else
        # 使用 .env.example 模板（如果存在）
        if [[ -f .env.example ]]; then
            cp .env.example .env
            log_info "已从 .env.example 创建 .env，请编辑填入您的 API Key"
        else
            # 创建带占位符的 .env
            cat > .env << 'EOF'
# MySQL 数据库
DB_PASSWORD=your_mysql_password
DB_HOST=mysql
DB_PORT=3306
DB_USER=root
DB_NAME=wa_crm_v2

# OpenAI
OPENAI_API_KEY=your_openai_api_key
OPENAI_API_BASE=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o
USE_OPENAI=false

# MiniMax
MINIMAX_API_KEY=your_minimax_api_key
MINIMAX_API_BASE=https://api.minimaxi.com/anthropic
EOF
            log_info "已创建 .env 模板，请编辑填入您的 API Key"
        fi
        echo ""
        log_warn "请编辑 .env 文件填入您的 API Key"
        read -p "编辑完成后按回车继续... "
    fi
}

# ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 6. 构建 Docker 镜像 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
build_docker() {
    log_info "[6/7] 构建 Docker 镜像..."
    docker compose build --no-cache
}

# ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 7. 启动 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
start_services() {
    log_info "[7/7] 启动容器..."
    docker compose up -d

    # 等待服务启动
    sleep 5

    # 检查状态
    if docker compose ps | grep -q "healthy"; then
        log_info "所有服务启动成功！"
    else
        log_warn "部分服务可能未完全就绪，请运行 'docker compose logs' 检查"
    fi
}

# ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** 主流程 ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***
main() {
    cd ~ || exit 1

    install_git
    install_docker
    setup_ssh
    clone_repo
    setup_env
    build_docker
    start_services

    echo ""
    echo "***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***"
    echo -e "${GREEN}  安装完成！${NC}"
    echo "***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***"
    echo "  访问地址: http://localhost:3000"
    echo "  查看日志: docker compose logs -f"
    echo "  停止服务: docker compose down"
    echo "***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***"
}

main "$@"
