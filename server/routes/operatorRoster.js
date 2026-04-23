/**
 * GET /api/operator-roster — 返回 canonical operator 列表,供 UsersPanel 下拉使用
 * 所有已认证用户都可读(DB admin/operator + env token 都可见,信息不敏感)
 *
 * 返回顺序:静态 roster(含手机号/alias 的 4 位固定成员) 在前,
 * users 表里新增的 operator_name(管理员动态添加) 追加在后,去重。
 */
const express = require('express');
const db = require('../../db');
const { getOperatorRoster } = require('../config/operatorRoster');

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        const staticRoster = getOperatorRoster().map((item) => ({
            operator: item.operator,
            real_name: item.real_name,
            wa_note: item.wa_note,
            source: 'static',
        }));

        let dynamicRows = [];
        try {
            dynamicRows = await db.getDb().prepare(`
                SELECT DISTINCT operator_name
                  FROM users
                 WHERE operator_name IS NOT NULL
                   AND operator_name <> ''
            `).all();
        } catch (dbErr) {
            console.error('GET /api/operator-roster users query failed:', dbErr);
        }

        const staticNames = new Set(staticRoster.map((item) => item.operator));
        const dynamicItems = [];
        const seen = new Set();
        for (const row of dynamicRows || []) {
            const name = row?.operator_name;
            if (!name || staticNames.has(name) || seen.has(name)) continue;
            seen.add(name);
            dynamicItems.push({
                operator: name,
                real_name: null,
                wa_note: null,
                source: 'dynamic',
            });
        }
        dynamicItems.sort((a, b) => String(a.operator).localeCompare(String(b.operator), 'zh-CN'));

        res.json({ ok: true, data: [...staticRoster, ...dynamicItems] });
    } catch (err) {
        console.error('GET /api/operator-roster error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
