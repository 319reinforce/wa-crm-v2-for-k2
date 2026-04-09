/**
 * WA CRM v2 Server — 模块化入口
 * 端口 3000
 */
require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('../db');

const jsonBody = require('./middleware/jsonBody');
const timeout = require('./middleware/timeout');
const messagesRouter = require('./routes/messages');
const creatorsRouter = require('./routes/creators');
const statsRouter = require('./routes/stats');
const aiRouter = require('./routes/ai');
const sftRouter = require('./routes/sft');
const policyRouter = require('./routes/policy');
const auditRouter = require('./routes/audit');
const profileRouter = require('./routes/profile');
const eventsRouter = require('./routes/events');
const experienceRouter = require('./routes/experience');
const waRouter = require('./routes/wa');

const app = express();
const PORT = 3000;

// 中间件
app.use(jsonBody);
app.use(timeout);

// 静态文件（开发环境）
if (process.env.NODE_ENV !***REMOVED*** 'production') {
    app.use(express.static(path.join(__dirname, '../public')));
}

// 路由注册
// 注意：messages 路由需要在 creators 路由之前挂载
app.use('/api/creators/:id/messages', messagesRouter);
app.use('/api/creators', creatorsRouter);
app.use('/api', statsRouter);
app.use('/api', aiRouter);
app.use('/api', sftRouter);
app.use('/api', policyRouter);
app.use('/api', auditRouter);
app.use('/api', profileRouter);
app.use('/api/events', eventsRouter);
app.use('/api/experience', experienceRouter);
app.use('/api/wa/send', waRouter);

// 启动服务器
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ WA CRM v2 Server (modular)`);
    console.log(`   Local:   http://localhost:${PORT}`);
    console.log(`   LAN:     http://192.168.1.51:${PORT}`);
    console.log(`   MySQL:   ${process.env.DB_NAME || 'wa_crm_v2'}\n`);
});

// graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully...');
    server.close(async () => {
        await db.closeDb();
        console.log('Server closed.');
        process.exit(0);
    });
});
process.on('SIGINT', async () => {
    console.log('SIGINT received, shutting down gracefully...');
    server.close(async () => {
        await db.closeDb();
        console.log('Server closed.');
        process.exit(0);
    });
});
