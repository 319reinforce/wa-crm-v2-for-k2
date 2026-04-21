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
- **项目根目录**: `/Users/lotusfall/k2lab/dev/K2Lab/whatsapp-mgr/`
- **后端入口**: `server/index.cjs`
- **模块化后端**: `server/`
- **前端**: `src/`

## 检查范围

### 1. 后端模块化代码（server/）
```bash
cd /Users/lotusfall/k2lab/dev/K2Lab/whatsapp-mgr
for f in server/index.cjs \
    db.js \
    systemPromptBuilder.cjs \
    server/routes/*.js \
    server/middleware/*.js \
    server/services/*.js \
    server/utils/*.js \
    server/constants/*.js \
    server/waWorker.js; do
  [ -f "$f" ] || continue
  echo "=== $f ==="
  node -c "$f" 2>&1
done
```

### 2. 前端代码（src/）
> 注意：`.jsx` 文件不能直接用 `node -c` 检查（需要 Vite/Babel loader），需要通过构建流程验证语法。`.js` 文件可以直接检查。
```bash
cd /Users/lotusfall/k2lab/dev/K2Lab/whatsapp-mgr
# JS 文件可直接检查
for f in src/utils/*.js \
    src/hooks/*.js \
    src/components/WAMessageComposer/**/*.js; do
  [ -f "$f" ] || continue
  echo "=== $f ==="
  node -c "$f" 2>&1 || echo "FAIL"
done
# JSX 文件通过 Vite 构建验证
npm run build 2>&1 | head -50
```

### 3. 关键 SQL 语法验证（静态检查）

检查是否有 MySQL 非法的 VALUES() 用法（在纯 UPDATE 中）：
```bash
cd /Users/lotusfall/k2lab/dev/K2Lab/whatsapp-mgr
grep -rn "UPDATE.*VALUES(" server/ --include="*.js" | grep -v "ON DUPLICATE KEY"
```

### 4. 时间戳处理一致性检查

检查 waWorker.js 中是否有遗留的 `* 1000`（WhatsApp API 使用秒，不应乘1000）：
```bash
cd /Users/lotusfall/k2lab/dev/K2Lab/whatsapp-mgr
grep -n "timestamp.*1000\|1000.*timestamp" server/waWorker.js
```

### 5. 缺失列/表引用检查
```bash
cd /Users/lotusfall/k2lab/dev/K2Lab/whatsapp-mgr
grep -rn "UPDATE.*ev_replied\|SET ev_replied" server/
```

### 6. JSON.parse 保护检查
```bash
cd /Users/lotusfall/k2lab/dev/K2Lab/whatsapp-mgr
for file in $(grep -rln "JSON\.parse" server/ --include="*.js"); do
  # 检查是否有 try/catch 保护
  if grep -B2 "JSON\.parse" "$file" | grep -q "try"; then
    continue
  fi
  # 排除注释中的 JSON.parse 引用
  if grep "JSON\.parse" "$file" | grep -q "^.*//"; then
    continue
  fi
  echo "POTENTIAL UNPROTECTED: $file"
done
```

### 7. 新增服务文件检查
```bash
cd /Users/lotusfall/k2lab/dev/K2Lab/whatsapp-mgr
for f in server/services/replyGenerationService.js \
    server/services/sftService.js \
    server/services/directMessagePersistenceService.js \
    server/services/profileService.js; do
  [ -f "$f" ] || { echo "MISSING: $f"; continue; }
  echo "=== $f ==="
  node -c "$f" 2>&1
done
```

### 8. 单元测试
```bash
cd /Users/lotusfall/k2lab/dev/K2Lab/whatsapp-mgr
node --test tests/*.test.mjs 2>&1
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

### 新增服务文件
- replyGenerationService.js: PASS/FAIL/MISSING
- sftService.js: PASS/FAIL/MISSING
- directMessagePersistenceService.js: PASS/FAIL/MISSING

### 单元测试
- tests/replyGenerationService.test.mjs: PASS/FAIL
- tests/sftService.test.mjs: PASS/FAIL

### 总结
**READY** / **ISSUES FOUND** (N issues)
```
