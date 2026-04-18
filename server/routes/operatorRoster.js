/**
 * GET /api/operator-roster — 返回 canonical operator 列表,供 UsersPanel 下拉使用
 * 所有已认证用户都可读(DB admin/operator + env token 都可见,信息不敏感)
 */
const express = require('express');
const { getOperatorRoster } = require('../config/operatorRoster');

const router = express.Router();

router.get('/', (req, res) => {
    try {
        const items = getOperatorRoster().map((item) => ({
            operator: item.operator,
            real_name: item.real_name,
            wa_note: item.wa_note,
        }));
        res.json({ ok: true, data: items });
    } catch (err) {
        console.error('GET /api/operator-roster error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
