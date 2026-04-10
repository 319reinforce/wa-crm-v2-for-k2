/**
 * WhatsApp Service — 单账号版本（Beau）
 */
const { Client, LocalAuth } = require('whatsapp-web.js');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
let qrterminal;
try { qrterminal = require('qrcode-terminal'); } catch(e) { qrterminal = null; }

// 每个 PORT 使用独立的 session 目录，支持多实例并行
const WA_PORT = parseInt(process.env.PORT || '3000', 10);
const SESSION_DIR = path.join(__dirname, `../../.wwebjs_auth/session-${WA_PORT}`);
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

// Shared EventEmitter so waWorker can wait for ready
const ee = new EventEmitter();

let client = null;
let ready = false;
let qr = null;
let reconnectTimer = null;  // 断开重连定时器，可清除

function initClient() {
    if (client) return client;

    console.log(`[WA Service] 初始化 WhatsApp Client...`);

    client = new Client({
        authStrategy: new LocalAuth({
            dir: SESSION_DIR,
            dataPath: SESSION_DIR,
        }),
        puppeteer: {
            executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        },
    });

    client.on('qr', (q) => {
        qr = q;
        console.log(`[WA Service] 需要扫码认证`);
        if (qrterminal) {
            console.log('═'.repeat(50));
            try { qrterminal.generate(q, { small: true }); } catch (e) { console.log('QR:', q); }
            console.log('═'.repeat(50));
        } else {
            // 无 qrcode-terminal 时直接打印 QR 数据
            console.log('QR:', q);
        }
        console.log(`WhatsApp → ⋮ → 已关联的设备 → 关联新设备 扫码上方二维码`);
    });

    client.on('ready', () => {
        ready = true;
        qr = null;
        console.log(`[WA Service] WhatsApp 已就绪!`);
        ee.emit('ready');
    });

    client.on('disconnected', () => {
        ready = false;
        client = null;
        console.log(`[WA Service] 已断开，5秒后重新连接...`);
        reconnectTimer = setTimeout(initClient, 5000);
    });

    client.initialize();
    return client;
}

/**
 * 启动 WhatsApp Client（由 server/index.cjs 在端口确认可用后调用）
 * 不再自动调用，支持多实例时按序初始化
 */
function start() {
    initClient();
}

module.exports = { sendMessage, getStatus, getClient: () => client, getReady: () => ready, waitForReady, stop, start };

async function sendMessage(phone, text) {
    if (!client || !ready) {
        return { ok: false, error: 'WhatsApp 未就绪，请先扫码认证' };
    }
    try {
        const cleanPhone = phone.replace(/[^\d+]/g, '');
        const chatId = cleanPhone.startsWith('+')
            ? cleanPhone.substring(1) + '@c.us'
            : cleanPhone + '@c.us';
        const messageId = await client.sendMessage(chatId, text);
        console.log(`[WA Service] 发送成功 → ${phone}: ${text.slice(0, 50)}`);
        return { ok: true, messageId };
    } catch (err) {
        console.error(`[WA Service] 发送失败 → ${phone}:`, err.message);
        return { ok: false, error: err.message };
    }
}

function getStatus() {
    return { ready, hasQr: !!qr, qr };
}

/**
 * 等待 WhatsApp Client 就绪（最多 timeoutMs）
 * @returns {Promise<void>}
 */
function waitForReady(timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
        if (ready) { resolve(); return; }
        const tid = setTimeout(() => {
            ee.removeListener('ready', onReady);
            reject(new Error('等待 WhatsApp 就绪超时'));
        }, timeoutMs);
        function onReady() {
            clearTimeout(tid);
            resolve();
        }
        ee.once('ready', onReady);
    });
}

/**
 * 停止 WhatsApp Service，清除所有定时器
 * 注意：destroy 前先移除 disconnected 监听，避免关闭时触发重连定时器
 */
function stop() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    if (client) {
        client.removeAllListeners('disconnected');
        client.destroy().catch(() => {});
        client = null;
    }
    ready = false;
    qr = null;
}

module.exports = { sendMessage, getStatus, getClient: () => client, getReady: () => ready, waitForReady, stop, start };
