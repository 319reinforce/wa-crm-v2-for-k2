/**
 * GET /api/operator-roster — 返回 canonical operator 列表,供 UsersPanel 下拉使用
 * 所有已认证用户都可读(DB admin/operator + env token 都可见,信息不敏感)
 *
 * 数据源(全部 union 去重):
 *   1. 静态 roster(含手机号/alias 的固定成员,source=static)
 *   2. users.operator_name        — 管理员绑定过的 owner
 *   3. creators.wa_owner          — 达人身上实际在用的 owner
 *   4. wa_sessions.owner          — WhatsApp 账号绑定的 owner
 *
 * 静态 roster 在前,其它来源作为 dynamic 追加,按 name zh-CN 排序。
 */
const express = require('express');
const db = require('../../db');
const { getOperatorRoster } = require('../config/operatorRoster');

const router = express.Router();

async function fetchDistinctNames(sql, label) {
    try {
        const rows = await db.getDb().prepare(sql).all();
        return (rows || [])
            .map((row) => {
                const v = row && (row.name ?? Object.values(row)[0]);
                return typeof v === 'string' ? v.trim() : '';
            })
            .filter(Boolean);
    } catch (err) {
        console.error(`GET /api/operator-roster ${label} failed:`, err.message);
        return [];
    }
}

router.get('/', async (req, res) => {
    try {
        const staticRoster = getOperatorRoster().map((item) => ({
            operator: item.operator,
            real_name: item.real_name,
            wa_note: item.wa_note,
            source: 'static',
        }));

        const [userNames, creatorOwners, sessionOwners] = await Promise.all([
            fetchDistinctNames(
                `SELECT DISTINCT operator_name AS name
                   FROM users
                  WHERE operator_name IS NOT NULL AND operator_name <> ''`,
                'users.operator_name',
            ),
            fetchDistinctNames(
                `SELECT DISTINCT wa_owner AS name
                   FROM creators
                  WHERE wa_owner IS NOT NULL AND wa_owner <> ''`,
                'creators.wa_owner',
            ),
            fetchDistinctNames(
                `SELECT DISTINCT owner AS name
                   FROM wa_sessions
                  WHERE owner IS NOT NULL AND owner <> ''`,
                'wa_sessions.owner',
            ),
        ]);

        const staticNames = new Set(staticRoster.map((item) => item.operator));
        const dynamicMap = new Map(); // name -> sources[]
        for (const [list, src] of [
            [userNames, 'users'],
            [creatorOwners, 'creators'],
            [sessionOwners, 'sessions'],
        ]) {
            for (const name of list) {
                if (staticNames.has(name)) continue;
                const existing = dynamicMap.get(name);
                if (existing) existing.push(src);
                else dynamicMap.set(name, [src]);
            }
        }

        const dynamicItems = [...dynamicMap.entries()]
            .map(([operator, sources]) => ({
                operator,
                real_name: null,
                wa_note: null,
                source: 'dynamic',
                seen_in: sources,
            }))
            .sort((a, b) => String(a.operator).localeCompare(String(b.operator), 'zh-CN'));

        res.json({ ok: true, data: [...staticRoster, ...dynamicItems] });
    } catch (err) {
        console.error('GET /api/operator-roster error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
