/**
 * WhatsApp Client - WA CRM v2
 * 使用 SQLite 存储数据
 */

require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

// 共享数据库库
const db = require('./db');

// Chrome 路径
const CHROME_PATH = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: CHROME_PATH,
        headless: false
    }
});

// 数据目录（用于兼容 JSON 备份）
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// ================== 工具函数 ==================
async function getContactName(contact) {
    return contact.name || contact.pushname || "Unknown";
}

function generateFileName(phone, name) {
    const safeName = (name || 'unknown').replace(/[^a-zA-Z0-9]/g, "_").substring(0, 20);
    return `${phone}_${safeName}_${new Date().toISOString().slice(0, 10)}.json`;
}

function findUserFile(phone) {
    const files = fs.readdirSync(DATA_DIR);
    return files.find(f => f.startsWith(phone + '_'));
}

// 标准化名字
function cleanName(name) {
    if (!name) return '';
    return name
        .replace(/\([^)]*\)/g, '')
        .replace(/[（）]/g, ' ')
        .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
        .replace(/[_\-\.]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

// 加载 operators
function loadOperators() {
    const OPERATORS_PATH = path.join(__dirname, '..', 'wa-ai-crm', 'operators.json');
    try {
        return JSON.parse(fs.readFileSync(OPERATORS_PATH, 'utf8'));
    } catch (e) {
        return { version: 1, operators: [] };
    }
}

// 检查是否为 Yiyun 达人
function isYiyunCreator(name, phone) {
    const operators = loadOperators();
    const yiyun = operators.operators.find(o => o.id === 'yiyun');
    if (!yiyun) return false;

    const clean = cleanName(name);
    const nameLower = (name || '').toLowerCase();

    // 1. 精确匹配
    if (yiyun.creators.some(c => cleanName(c) === clean)) return true;

    // 2. 括号内 TikTok 用户名
    const tiktokMatch = nameLower.match(/\(([^)]+)\)/);
    if (tiktokMatch) {
        if (yiyun.creators.some(c => cleanName(c) === tiktokMatch[1].toLowerCase())) return true;
    }

    // 3. creator_tiktok_map
    const tiktokMap = yiyun.creator_tiktok_map || {};
    for (const key of Object.keys(tiktokMap)) {
        if (nameLower.includes(key.toLowerCase())) return true;
        if (cleanName(key) === clean) return true;
    }
    const allTiktoks = Object.values(tiktokMap).map(t => t.toLowerCase());
    for (const t of allTiktoks) {
        if (nameLower.includes(t)) return true;
    }

    // 4. 包含匹配
    for (const c of yiyun.creators) {
        const cc = cleanName(c);
        if (clean.includes(cc) || cc.includes(clean)) return true;
    }

    return false;
}

// ================== 事件检测 ==================
function hasChinese(text) {
    return /[\u4e00-\u9fff]/.test(text);
}

function isValidUSUser(phone, name, messages = [], bypassYiyun = false) {
    if (bypassYiyun) {
        if (phone.startsWith('+86')) return false;
        const phoneDigits = phone.replace(/\D/g, '');
        if (phoneDigits.length === 11 && !phoneDigits.startsWith('1')) return false;
        if (phone.startsWith('+') && !phone.startsWith('+1')) return false;
        if (messages.length > 0) {
            const chineseMsgs = messages.filter(m => hasChinese(m.text || ''));
            if (chineseMsgs.length > messages.length * 0.5) return false;
        }
        if ((name || '').toLowerCase().includes('moras')) return false;
        return true;
    }

    // 普通用户
    if (phone.startsWith('+86')) return false;
    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length === 11 && !phoneDigits.startsWith('1')) return false;
    if (phone.startsWith('+') && !phone.startsWith('+1')) return false;
    if (messages.length > 0) {
        const chineseMsgs = messages.filter(m => hasChinese(m.text || ''));
        if (chineseMsgs.length > messages.length * 0.5) return false;
    }
    if ((name || '').toLowerCase().includes('moras')) return false;
    if (messages.length < 3) return false;
    const cutoffDate = new Date('2026-01-21').getTime();
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.timestamp * 1000 < cutoffDate) return false;

    return true;
}

// ================== 保存函数 ==================
function saveHistoryMessages(phone, name, messages) {
    const fileName = findUserFile(phone) || generateFileName(phone, name);
    const filePath = path.join(DATA_DIR, fileName);

    let data;
    let isNewFile = false;
    try {
        data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        // JSON 文件不存在，说明是首次同步，使用 WhatsApp 传入的 messages
        data = {
            phone,
            name,
            source: 'history_sync',
            created_at: Date.now(),
            events: {
                violations: [],
                monthly_beta: { joined: false, joined_at: null, cycle_start_date: null, program_type: '20_day_beta', status: 'not_introduced' },
                agency_binding: { bound: false, bound_at: null, deadline: null },
                monthly_fee: { amount: 20, due_date: null, deducted: false, deducted_at: null, status: 'pending' },
                weekly_videos: { current_week: 0, target_daily: 5, target_weekly: 35, target_bonus: 40, current_count: 0, last_checked: null, history: [] },
                referrals: []
            },
            tags: [],
            messages: [],
            analysis: { last_analyzed_index: 0, history: [] },
            score: { urgency_level: 0, event_score: 0, next_action: '', priority: 'low', last_updated: Date.now() }
        };
        isNewFile = true;
    }

    const existingTimestamps = new Set(data.messages.map(m => m.timestamp));

    // 从 WhatsApp 消息中过滤出不在 JSON 文件中的新消息
    const newMsgs = messages.filter(m => m.body && !existingTimestamps.has(m.timestamp * 1000));
    if (newMsgs.length === 0) return 0;

    // 先写 SQLite，失败则不写 JSON（保持一致）
    try {
        const creatorId = db.getOrCreateCreator(phone, name, 'wa');

        const yiyun = isYiyunCreator(name, phone);
        if (yiyun) {
            db.updateCreator(creatorId, { wa_owner: 'Yiyun' });
        }

        const msgsToInsert = newMsgs.map(m => ({
            role: m.fromMe ? 'me' : 'user',
            text: m.body,
            timestamp: m.timestamp * 1000
        }));
        db.insertMessagesBatch(creatorId, msgsToInsert);
    } catch (e) {
        console.error(`SQLite error for ${name}, skipping JSON write:`, e.message);
        return 0;
    }

    // SQLite 成功后再追加写入 JSON
    for (const msg of newMsgs) {
        data.messages.push({
            role: msg.fromMe ? 'me' : 'user',
            text: msg.body,
            timestamp: msg.timestamp * 1000
        });
    }
    data.messages.sort((a, b) => a.timestamp - b.timestamp);
    data.name = name;
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`💾 ${name}: ${newMsgs.length} 条新消息 (SQLite + JSON)`);

    return newMsgs.length;
}

// ================== 定时同步 ==================
const POLL_INTERVAL_MS = 5 * 60 * 1000;

async function pollNewMessages() {
    console.log(`[Polling] 开始检查新消息...`);
    try {
        const chats = await client.getChats();

        for (const chat of chats) {
            if (chat.isGroup) continue;

            const contact = await chat.getContact().catch(() => null);
            if (!contact) continue;
            const phone = contact.number;
            const name = await getContactName(contact);

            const yiyun = isYiyunCreator(name, phone);
            if (!isValidUSUser(phone, name, [], yiyun)) continue;

            const fileName = findUserFile(phone);
            if (!fileName) continue;

            const filePath = path.join(DATA_DIR, fileName);
            const existingData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

            let recentMessages;
            try {
                recentMessages = await chat.fetchMessages({ limit: yiyun ? 500 : 100 });
            } catch (err) {
                if (err.message.includes('detached Frame')) {
                    console.log(`[Polling] ${name}: Frame detached, skipping`);
                }
                continue;
            }

            const existingTimestamps = new Set(existingData.messages.map(m => m.timestamp));
            const newMsgs = recentMessages.filter(m => !existingTimestamps.has(m.timestamp * 1000));

            if (newMsgs.length === 0) continue;

            console.log(`[Polling] ${name}: 发现 ${newMsgs.length} 条新消息`);

            for (const msg of newMsgs) {
                if (msg.fromMe) {
                    existingData.messages.push({ role: 'me', text: msg.body, timestamp: msg.timestamp * 1000 });
                } else {
                    existingData.messages.push({ role: 'user', text: msg.body, timestamp: msg.timestamp * 1000 });
                }
            }

            existingData.messages.sort((a, b) => a.timestamp - b.timestamp);

            // 先写 SQLite，失败则跳过 JSON
            try {
                const creatorId = db.getOrCreateCreator(phone, name, 'wa');
                const msgsToInsert = newMsgs.map(m => ({
                    role: m.fromMe ? 'me' : 'user',
                    text: m.body,
                    timestamp: m.timestamp * 1000
                }));
                db.insertMessagesBatch(creatorId, msgsToInsert);
            } catch (e) {
                console.error(`SQLite sync error for ${name}, skipping:`, e.message);
                continue;
            }

            // SQLite 成功后再写 JSON 备份
            fs.writeFileSync(filePath, JSON.stringify(existingData, null, 2));
        }

        console.log(`[Polling] 检查完成`);
    } catch (err) {
        console.error("[Polling] Error:", err.message);
    }
}

// ================== 启动 ==================
client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log('✅ WhatsApp Ready (WA CRM v2 - SQLite)');

    const chats = await client.getChats();

    for (const chat of chats) {
        if (chat.isGroup) continue;

        const contact = await chat.getContact().catch(() => null);
        if (!contact) continue;
        const phone = contact.number;
        const name = await getContactName(contact);

        const yiyun = isYiyunCreator(name, phone);
        const msgLimit = yiyun ? 500 : 100;
        const messages = await chat.fetchMessages({ limit: msgLimit });

        if (!isValidUSUser(phone, name, messages, yiyun)) {
            console.log(`⏭️ 跳过: ${name} (${phone})`);
            continue;
        }

        console.log(`✅ ${name} (${phone}) - ${messages.length} 条消息`);
        saveHistoryMessages(phone, name, messages);
    }

    console.log("✅ History synced");

    // 启动定时轮询
    setTimeout(() => {
        console.log(`[Polling] 定时同步已启动，每 ${POLL_INTERVAL_MS / 1000 / 60} 分钟检查一次`);
        pollNewMessages();
        setInterval(pollNewMessages, POLL_INTERVAL_MS);
    }, 10000);
});

client.on('message', async msg => {
    try {
        if (msg.fromMe) return;
        if (msg.chat?.isGroup) return;

        const contact = await msg.getContact();
        const phone = contact.number;
        const name = await getContactName(contact);

        const yiyun = isYiyunCreator(name, phone);
        if (!isValidUSUser(phone, name, [], yiyun)) return;

        const text = msg.body;
        console.log(`📩 ${phone}: ${text.substring(0, 50)}`);

        // 保存到 SQLite
        try {
            const creatorId = db.getOrCreateCreator(phone, name, 'wa');
            db.insertMessage(creatorId, 'user', text, Date.now());
        } catch (e) {
            console.error(`SQLite insert error:`, e.message);
        }

    } catch (e) {
        console.error('Message handler error:', e.message);
    }
});

client.on('disconnected', () => {
    console.log('⚠️ WhatsApp disconnected, reconnecting...');
});

console.log('🔄 Starting WA CRM v2 (SQLite)...');
client.initialize();
