---
name: syntax-check
description: "语法检查 WA CRM v2 项目所有后端模块化代码"
user-invocable: true
allowed-tools: Bash, Read, Grep
context: fork
---

# Syntax Check Skill

对 WA CRM v2 项目进行全面的 Node.js 语法检查。

## 项目路径
- **项目根目录**: `/Users/depp/wa-bot/wa-crm-v2/`
- **后端入口**: `server/index.cjs`
- **模块化后端**: `server/`
- **前端**: `src/`
- **根目录旧文件**（检查是否残留）: `server.js`, `routes/`, `db.js`

## 检查范围

### 1. 后端模块化代码（server/）
```bash
cd /Users/depp/wa-bot/wa-crm-v2
for f in server/index.cjs \
    db.js \
    systemPromptBuilder.cjs \
    server/routes/*.js \
    server/middleware/*.js \
    server/services/*.js \
    server/utils/*.js \
    server/constants/*.js \
    server/waWorker.js; do
  echo "=== $f ==="
  node -c "$f" 2>&1
done
```

### 2. 前端代码（src/）
```bash
cd /Users/depp/wa-bot/wa-crm-v2
for f in src/App.jsx \
    src/components/*.jsx \
    src/utils/*.js; do
  echo "=== $f ==="
  node -c "$f" 2>&1 || echo "FAIL"
done
```

### 3. 根目录残留文件检查
```bash
cd /Users/depp/wa-bot/wa-crm-v2
# 检查旧文件是否还存在（MySQL 迁移后这些应该被移除或废弃）
ls server.js routes/ db.js 2>&1
```

### 4. 关键 SQL 语法验证（静态检查）

检查是否有 MySQL 非法的 VALUES() 用法（在纯 UPDATE 中）：
```bash
cd /Users/depp/wa-bot/wa-crm-v2
grep -rn "UPDATE.*VALUES(" server/ --include="*.js" | grep -v "ON DUPLICATE KEY"
```

### 5. 时间戳处理一致性检查

检查 waWorker.js 中是否有遗留的 `* 1000`（WhatsApp API 使用秒，不应乘1000）：
```bash
cd /Users/depp/wa-bot/wa-crm-v2
grep -n "timestamp.*1000\|1000.*timestamp" server/waWorker.js
```

### 6. 缺失列/表引用检查

检查代码中引用的列是否存在于 schema.sql：
```bash
cd /Users/depp/wa-bot/wa-crm-v2
# ev_replied 不应出现在 UPDATE 语句中（它是 SQL 子查询动态计算的）
grep -rn "UPDATE.*ev_replied\|SET ev_replied" server/
```

### 7. JSON.parse 保护检查
```bash
cd /Users/depp/wa-bot/wa-crm-v2
grep -rn "JSON\.parse" server/ --include="*.js" | while read line; do
  file=$(echo "$line" | cut -d: -f1)
  lineno=$(echo "$line" | cut -d: -f2)
  # 检查前后5行是否有 try 或 function 包裹
  if ! grep -B5 "JSON\.parse" "$file" | grep -q "try"; then
    echo "POTENTIAL UNPROTECTED: $file:$lineno"
  fi
done
```

## 输出格式

```
## 语法检查报告

### 后端模块 (server/)
| 文件 | 状态 |
|------|------|
| server/index.cjs | PASS/FAIL |
| db.js | PASS/FAIL |
| ... | ... |

### 前端代码 (src/)
| 文件 | 状态 |
|------|------|
| src/App.jsx | PASS/FAIL |
| ... | ... |

### SQL 安全检查
- VALUES() in UPDATE: [PASS/ISSUE FOUND]
- timestamp * 1000: [PASS/ISSUE FOUND]
- ev_replied in UPDATE: [PASS/ISSUE FOUND]

### JSON.parse 保护
- [LIST any unprotected JSON.parse calls]

### 残留文件
- [LIST any old files still present]

### 总结
**READY** / **ISSUES FOUND** (N issues)
```
