# Regression Scripts

## 用途

`creators-owner-switch.sh` 用来做 `/api/creators` 的 owner 切换回归验证，支持三步工作流：

1. 抓一份 `baseline`
2. 抓一份 `candidate`
3. 对比两者是否违反 `docs/CREATORS_API_CONTRACT.md` 里的回归协议

脚本不会直接 `diff` 整个 JSON，而是按契约字段比较：

- `creators[].id` 集合
- `creators[].id` 顺序
- `ev_replied`
- `message_facts`
- `lifecycle.stage_key`
- `lifecycle.flags`
- candidate 是否泄露内部列

## 前置条件

- 本地服务已启动，默认地址是 `http://localhost:3000/api`
- 如果接口开启鉴权，设置 `REGRESSION_TOKEN`
- 需要本机有 `bash`、`curl` 和 `node`

鉴权方式会走：

```bash
Authorization: Bearer $REGRESSION_TOKEN
```

如果没有设置 `REGRESSION_TOKEN`，脚本仍会继续跑，但会打印匿名请求警告。

## 用法

```bash
scripts/regression/creators-owner-switch.sh baseline
scripts/regression/creators-owner-switch.sh candidate
scripts/regression/creators-owner-switch.sh diff
```

默认快照目录：

```bash
./regression-snapshots/
  baseline/
  candidate/
```

可选环境变量：

```bash
API_BASE=http://localhost:3000/api
SNAP_DIR=./regression-snapshots
REGRESSION_TOKEN=...
LIFECYCLE_STAGE_VALUE=onboarding
MONTHLY_FEE_STATUS_VALUE=paid
```

其中：

- `LIFECYCLE_STAGE_VALUE` 默认 `onboarding`
- `MONTHLY_FEE_STATUS_VALUE` 默认 `paid`
- 文件名仍固定为 `all-lifecycle-stage-onboarding.json` 和 `all-monthly-fee-paid.json`，方便和验证方案保持一致

## 抓取覆盖范围

脚本会为以下查询各抓一份 `json`，并统一附带 `fields=wa_phone`：

- `owner=Beau`
- `owner=Yiyun`
- 无 `owner`
- `owner=Beau&event=replied`
- `owner=Beau&event=joined`
- `owner=BEAU`
- `owner=beau`
- `lifecycle_stage=onboarding`
- `monthly_fee_status=paid`

## 典型输出

无差异时：

```text
OK owner-beau: no contract drift
...
OK all snapshots: 9 query variants matched
```

有差异时：

```text
DIFF owner-beau: field-level regressions
  creator=123 ev_replied baseline=1 candidate=0
```

顺序漂移时会单独标成 `WARN`，但仍然按回归失败处理并返回非 0 退出码。

## 失败时怎么定位

先看脚本输出的 query key 和 creator id，确认是集合差异、排序差异还是字段差异。

如果需要看原始响应，直接对对应快照做人工 diff：

```bash
diff -u regression-snapshots/baseline/owner-beau.json regression-snapshots/candidate/owner-beau.json
```

也可以优先检查差异最大的那一对快照，通常最快定位到排序变化或内部字段泄露。
