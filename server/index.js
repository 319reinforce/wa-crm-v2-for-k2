/**
 * WA CRM v2 Server — 模块化入口
 * 端口 3000
 */
require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('../db');

const app = express();
const PORT = 3000;

// 中间件
const jsonBody = require('./middleware/jsonBody');
const timeout = require('./middleware/timeout');
app.use(jsonBody);
app.use(timeout);

// 静态文件（开发环境）
if (process.env.NODE_ENV !***REMOVED*** 'production') {
    app.use(express.static(path.join(__dirname, '../public')));
}

// 路由注册
// 注意：messages 路由需要在 creators 路由之前挂载，避免 /api/creators/:id/messages 被 creators 的 /:id 先匹配
// messages 使用 mergeParams:true，当请求是 /api/creators/:id/messages 时，/:id param 会被 creators 路由捕获
// 所以 messages 路由必须 mount 在 /api/creators/:id/messages，creators mount 在 /api/creators
// 但 /api/creators/:id/messages 不会 match creators 的 /api/creators（多了一段），所以顺序不影响
app.use('/api/creators/:id/messages', require('./routes/messages'));
app.use('/api/creators', require('./routes/creators'));
app.use('/api', require('./routes/stats'));
app.use('/api', require('./routes/ai'));
app.use('/api', require('./routes/sft'));
app.use('/api', require('./routes/policy'));
app.use('/api', require('./routes/audit'));
app.use('/api', require('./routes/profile'));
app.use('/api/events', require('./routes/events'));
app.use('/api/experience', require('./routes/experience'));

// 启动服务器
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ WA CRM v2 Server (modular)`);
    console.log(`   Local:   http://localhost:${PORT}`);
    console.log(`   LAN:     http://192.168.1.51:${PORT}`);
    console.log(`   SQLite:  crm.db\n`);
});

// graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    server.close(() => {
        db.closeDb();
        console.log('Server closed.');
        process.exit(0);
    });
});
process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully...');
    server.close(() => {
        db.closeDb();
        console.log('Server closed.');
        process.exit(0);
    });
});
