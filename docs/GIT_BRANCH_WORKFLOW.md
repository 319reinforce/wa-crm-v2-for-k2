# WA CRM v2 Git Branch Workflow

## 目标

统一 WA CRM v2 后续开发分支策略，减少临时分支长期滞留、测试线混乱和主线合并不清晰的问题。

从 2026-04-17 开始，新任务统一按 `dev -> feature/*` 或 `dev -> fix/*` 进行。

---

## 核心分支

| 分支 | 用途 | 来源 | 合并目标 |
|------|------|------|----------|
| `main` | 生产环境 / 线上可部署版本 | 长期分支 | 仅接收 `dev` 或 `hotfix/*` |
| `dev` | 开发集成 / 测试环境 | 从 `main` 建立并长期存在 | 接收 `feature/*` 与 `fix/*` |
| `feature/*` | 新功能开发 | 从 `dev` 拉出 | 合并回 `dev` |
| `fix/*` | 普通缺陷修复 | 从 `dev` 拉出 | 合并回 `dev` |
| `hotfix/*` | 线上紧急修复 | 从 `main` 拉出 | 先合并回 `main`，再同步回 `dev` |

---

## 规则

1. `main` 永远保持可部署，不直接在上面开发。
2. `dev` 是默认集成线，所有常规开发先进入 `dev`，验证后再进入 `main`。
3. 新功能一律使用 `feature/*`，不要继续创建长期使用的 `codex/*` 功能分支。
4. 普通 bug 一律使用 `fix/*`，不要直接在 `dev` 上改。
5. 线上事故才使用 `hotfix/*`，并且修完后必须同时回合到 `main` 和 `dev`。
6. `codex/*` 只保留给 AI / 临时实验 / 一次性工作流，不作为长期协作命名规范。
7. 旧的 `origin/test` 暂时保留兼容，但后续新任务不要再基于 `test` 开发。

---

## 日常开发流程

### 功能开发

```bash
git fetch origin
git checkout dev
git pull

git checkout -b feature/xxx

# 开发 + 提交
git add .
git commit -m "feat: xxx"

git push origin feature/xxx
```

### 普通 bug 修复

```bash
git fetch origin
git checkout dev
git pull

git checkout -b fix/xxx

# 修复 + 提交
git add .
git commit -m "fix: xxx"

git push origin fix/xxx
```

### 线上 hotfix

```bash
git fetch origin
git checkout main
git pull

git checkout -b hotfix/xxx

# 修复 + 提交
git add .
git commit -m "hotfix: xxx"

git push origin hotfix/xxx
```

修复完成后：

1. 合并 `hotfix/*` 到 `main`
2. 再把同一个修复同步回 `dev`

---

## 命名建议

- `feature/wa-auto-reply`
- `feature/user-tag-system`
- `feature/payment-stripe`
- `fix/login-error`
- `fix/message-duplicate`
- `hotfix/payment-crash`
- `hotfix/api-500`

分支名尽量短、可读、可定位，不要使用无语义随机后缀。

---

## 当前落地状态

- `main` 已存在
- `dev` 已于 2026-04-17 从 `origin/main` 建立并推送到远端
- 后续新任务从 `dev` 开始
- 历史 `codex/*` 分支保留，但不再作为长期团队规范
