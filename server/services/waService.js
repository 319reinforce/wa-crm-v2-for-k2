/**
 * WhatsApp Service — whatsapp-web.js 多账号封装
 * 每个 operator 独立 session 目录
 */
const { Client, LocalAuth } = require('whatsapp-web.js');
const path = require('path');
const fs = require('fs');

// Session 根目录
const SESSION_BASE = path.join(__dirname, '../../.wwebjs_auth');

// 各 operator session 目录（与 old wa-ai-crm 兼容）
const OPERATOR_SESSIONS = {
    Beau: path.join(SESSION_BASE, 'sessions-beau'),
    Yiyun: path.join(SESSION_BASE, 'sessions-yiyun'),
    WangYouKe: path.join(SESSION_BASE, 'sessions-wangyouke'),
};

// 默认用 Beau
const DEFAULT_OPERATOR = 'Beau';

// 确保所有 session 目录存在
Object.values(OPERATOR_SESSIONS).forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// 多账号 client 映射
const clients = {};  // operator → { client, ready, qr }
const pendingInits = {}; // 防止重复初始化

function initClient(operator = DEFAULT_OPERATOR) {
    if (clients[operator]?.client) return clients[operator].client;
    if (pendingInits[operator]) return null;

    const sessionDir = OPERATOR_SESSIONS[operator] || OPERATOR_SESSIONS[Beau];
    pendingInits[operator] = true;

    console.log(`[WA Service] 初始化 ${operator} WhatsApp Client (session: ${sessionDir})...`);

    const client = new Client({
        authStrategy: new LocalAuth({
            dir: sessionDir,
            dataPath: sessionDir,
        }),
        puppeteer: {
            executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        },
    });

    clients[operator] = { client, ready: false, qr: null };

    client.on('qr', (qr) => {
        clients[operator].qr = qr;
        console.log(`[WA Service] ${operator} 需要扫码认证 → GET /api/wa/qr?operator=${operator}`);
    });

    client.on('ready', () => {
        clients[operator].ready = true;
        clients[operator].qr = null;
        console.log(`[WA Service] ${operator} WhatsApp 已就绪!`);
    });

    client.on('disconnected', () => {
        clients[operator].ready = false;
        clients[operator].client = null;
        console.log(`[WA Service] ${operator} 已断开，5秒后重新连接...`);
        delete clients[operator].client;
        setTimeout(() => { delete pendingInits[operator]; initClient(operator); }, 5000);
    });

    client.initialize();
    delete pendingInits[operator];

    return client;
}

// 预初始化所有 operator
Object.keys(OPERATOR_SESSIONS).forEach(op => initClient(op));

/**
 * 发送 WhatsApp 消息
 * @param {string} phone - 目标手机号
 * @param {string} text - 消息内容
 * @param {string} operator - 用哪个 operator 的账号发送（Beau/Yiyun/WangYouKe）
 */
async function sendMessage(phone, text, operator = DEFAULT_OPERATOR) {
    const account = clients[operator];
    if (!account?.client || !account.ready) {
        return { ok: false, error: `${operator} WhatsApp 未就绪，请先扫码认证` };
    }

    try {
        const cleanPhone = phone.replace(/[^\d+]/g, '');
        const chatId = cleanPhone.startsWith('+')
            ? cleanPhone.substring(1) + '@c.us'
            : cleanPhone + '@c.us';

        const messageId = await account.client.sendMessage(chatId, text);
        console.log(`[WA Service] ${operator} 发送成功 → ${phone}: ${text.slice(0, 50)}`);
        return { ok: true, messageId };
    } catch (err) {
        console.error(`[WA Service] ${operator} 发送失败 → ${phone}:`, err.message);
        return { ok: false, error: err.message };
    }
}

function getStatus(operator = DEFAULT_OPERATOR) {
    const account = clients[operator];
    return {
        operator,
        ready: account?.ready || false,
        hasQr: !!account?.qr,
        qr: account?.qr || null,
    };
}

function getAllStatus() {
    return Object.keys(OPERATOR_SESSIONS).map(op => ({
        operator: op,
        sessionDir: OPERATOR_SESSIONS[op],
        ...getStatus(op),
    }));
}

module.exports = { sendMessage, getStatus, getAllStatus, OPERATOR_SESSIONS };
