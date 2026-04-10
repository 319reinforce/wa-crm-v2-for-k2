FROM node:20-slim

# 接收前端构建时环境变量
ARG VITE_USE_OPENAI=false
ARG VITE_OPENAI_API_KEY=
ARG VITE_OPENAI_API_BASE=https://api.openai.com/v1
ARG VITE_OPENAI_MODEL=gpt-4o

ENV VITE_USE_OPENAI=${VITE_USE_OPENAI}
ENV VITE_OPENAI_API_KEY=${VITE_OPENAI_API_KEY}
ENV VITE_OPENAI_API_BASE=${VITE_OPENAI_API_BASE}
ENV VITE_OPENAI_MODEL=${VITE_OPENAI_MODEL}

WORKDIR /app

# 安装构建工具和 Python（deasync 需要）
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖文件
COPY package*.json ./

# 安装依赖
RUN npm install

# 复制源代码
COPY . .

# 构建前端（Vite 输出到 public/）
RUN npm run build

# 暴露端口
EXPOSE 3000

# 启动后端（生产模式自动 serve public/ 静态文件）
CMD ["node", "server/index.cjs"]
