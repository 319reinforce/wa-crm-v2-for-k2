#!/usr/bin/env node
/**
 * backfill-incoming-media.cjs
 *
 * 补充 wa_messages 中缺失的媒体数据。
 * 查找: hasMedia=true 但 media_asset_id=NULL 的消息。
 * 适用于: 历史同步期间媒体下载被跳过、或存储期间出错的情况。
 *
 * 用法:
 *   node scripts/backfill-incoming-media.cjs                       # 补充最近 100 条
 *   node scripts/backfill-incoming-media.cjs --dry-run             # 仅预览
 *   node scripts/backfill-incoming-media.cjs --creator-id=3320   # 仅指定 creator
 *   node scripts/backfill-incoming-media.cjs --limit=50          # 限制数量
 *   node scripts/backfill-incoming-media.cjs --days=30           # 仅最近 N 天内的消息
 *   node scripts/backfill-incoming-media.cjs --session=3000     # 指定 WA session
 */

'use strict';

const path = require('path');

process.chdir(path.resolve(__dirname, '..'));

const { initDb, getDb } = require('../db');
const { startAllServices, getClient, waitForReady } = require('../server/services/waService');

const LOG_PREFIX = '[backfill-incoming-media]';

function parseArgs(argv) {
  const options = {
    dryRun: false,
    creatorId: null,
    limit: 100,
    days: null,
    batchSize: 5,
    sessionId: null,
  };
  for (const entry of argv) {
    if (entry === '--dry-run') { options.dryRun = true; continue; }
    if (entry.startsWith('--creator-id=')) { options.creatorId = parseInt(entry.slice(12), 10) || null; continue; }
    if (entry.startsWith('--limit=')) { options.limit = parseInt(entry.slice(8), 10) || 100; continue; }
    if (entry.startsWith('--days=')) { options.days = parseInt(entry.slice(6), 10) || null; continue; }
    if (entry.startsWith('--batch-size=')) { options.batchSize = parseInt(entry.slice(12), 10) || 5; continue; }
    if (entry.startsWith('--session=')) { options.sessionId = entry.slice(9).trim() || null; continue; }
  }
  return options;
}

async function findMissingMediaMessages(db, options) {
  let sql = `
    SELECT m.id, m.creator_id, m.timestamp, m.text,
           c.wa_phone, c.primary_name,
           m.media_mime
    FROM wa_messages m
    JOIN creators c ON c.id = m.creator_id
    WHERE m.media_asset_id IS NULL
      AND m.media_mime IS NOT NULL
      AND m.media_download_status IS NULL
  `;
  const params = [];

  if (options.creatorId) {
    sql += ' AND m.creator_id = ?';
    params.push(options.creatorId);
  }

  if (options.days) {
    const cutoff = Date.now() - options.days * 24 * 60 * 60 * 1000;
    sql += ' AND m.timestamp >= ?';
    params.push(cutoff);
  }

  sql += ' ORDER BY m.timestamp DESC LIMIT ?';
  params.push(options.limit);

  return db.prepare(sql).all(...params);
}

async function resolveChatWidByPhone(client, phone) {
  if (!client?.pupPage) return null;
  try {
    return await client.pupPage.evaluate(async (targetPhone) => {
      const contact = await window.Store.Contact.get(targetPhone).catch(() => null);
      if (!contact) return null;
      const chat = await window.Store.Chat.find(contact).catch(() => null);
      return chat?.id?._serialized || null;
    }, `+${phone.replace(/\D/g, '')}@c.us`);
  } catch (e) {
    return null;
  }
}

async function fetchMessageFromStore(client, chatWid, msgTimestamp) {
  if (!client?.pupPage) return null;
  try {
    return await client.pupPage.evaluate(async (targetChatWid, targetTimestamp) => {
      const chatModel = window.Store.Chat.get(targetChatWid);
      if (!chatModel) return null;
      const msgs = chatModel.msgs?.getModelsArray() || [];
      // 找时间戳最接近的消息
      const targetMs = Number(targetTimestamp);
      let closest = null;
      let minDiff = Infinity;
      for (const msg of msgs) {
        const diff = Math.abs(Number(msg.t) * 1000 - targetMs);
        if (diff < minDiff) {
          minDiff = diff;
          closest = msg;
        }
      }
      if (!closest || minDiff > 60000) return null; // 超过 60s 误差就算了
      return closest;
    }, chatWid, msgTimestamp);
  } catch (e) {
    return null;
  }
}

async function updateMessageMediaInfo(db, msgId, mediaInfo) {
  if (mediaInfo) {
    await db.prepare(`
      UPDATE wa_messages
      SET media_asset_id = ?,
          media_type = ?,
          media_mime = ?,
          media_size = ?,
          media_width = ?,
          media_height = ?,
          media_caption = ?,
          media_thumbnail = ?,
          media_download_status = 'success'
      WHERE id = ?
    `).run(
      mediaInfo.mediaAssetId,
      mediaInfo.mediaType,
      mediaInfo.mime,
      mediaInfo.size,
      mediaInfo.width,
      mediaInfo.height,
      mediaInfo.caption,
      mediaInfo.thumbnail,
      msgId
    );
  } else {
    await db.prepare(`
      UPDATE wa_messages
      SET media_download_status = 'failed'
      WHERE id = ?
    `).run(msgId);
  }
}

function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length <= 4) return '***';
  return `***${digits.slice(-4)}`;
}

async function processBatch(client, db, messages, options) {
  const results = { success: 0, failed: 0, skipped: 0 };

  for (const msg of messages) {
    if (!msg.wa_phone) { results.skipped++; continue; }

    const preview = `${String(msg.text || msg.media_mime || '').slice(0, 30)}`;

    if (options.dryRun) {
      console.log(`  [dry-run] would backfill msg #${msg.id} (creator=${msg.creator_id}, phone=${maskPhone(msg.wa_phone)}, text=${preview})`);
      results.success++;
      continue;
    }

    // 1. 获取 chat wid
    const chatWid = await resolveChatWidByPhone(client, msg.wa_phone);
    if (!chatWid) {
      console.warn(`  skip msg #${msg.id}: cannot resolve chat for phone ${maskPhone(msg.wa_phone)}`);
      await updateMessageMediaInfo(db, msg.id, null);
      results.failed++;
      continue;
    }

    // 2. 在 store 中查找消息（按时间戳匹配，误差 60s 内）
    const rawMsg = await fetchMessageFromStore(client, chatWid, msg.timestamp);
    if (!rawMsg) {
      console.warn(`  skip msg #${msg.id}: message not in memory (ts=${msg.timestamp})`);
      await updateMessageMediaInfo(db, msg.id, null);
      results.failed++;
      continue;
    }

    if (!rawMsg.hasMedia) {
      console.warn(`  skip msg #${msg.id}: message no longer has media (may have been cleared by WhatsApp)`);
      await updateMessageMediaInfo(db, msg.id, null);
      results.failed++;
      continue;
    }

    // 3. 下载媒体
    let mediaInfo = null;
    try {
      const { downloadAndStoreIncomingMedia } = require('../server/services/waIncomingMediaService');
      mediaInfo = await Promise.race([
        downloadAndStoreIncomingMedia(rawMsg, {
          creatorId: msg.creator_id,
          operator: process.env.WA_OWNER || 'Beau',
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('backfill_download_timeout')), 30000)
        ),
      ]);
    } catch (e) {
      console.warn(`  download failed for msg #${msg.id}: ${e.message}`);
    }

    // 4. 更新数据库
    await updateMessageMediaInfo(db, msg.id, mediaInfo);
    if (mediaInfo) {
      console.log(`  ✅ msg #${msg.id}: media backed up (asset=${mediaInfo.mediaAssetId}, type=${mediaInfo.mediaType})`);
      results.success++;
    } else {
      console.warn(`  ❌ msg #${msg.id}: download failed, marked as failed`);
      results.failed++;
    }

    // 批次间延迟
    await new Promise(r => setTimeout(r, 1000));
  }

  return results;
}

async function main(argv) {
  const options = parseArgs(argv);
  console.log(`${LOG_PREFIX} 启动 (dry-run=${options.dryRun}, limit=${options.limit}, days=${options.days || '全部'}, batch=${options.batchSize}, session=${options.sessionId || 'default'})`);

  initDb();
  const db = getDb();

  // 初始化 WA client（等待就绪）
  console.log(`${LOG_PREFIX} 等待 WhatsApp 就绪...`);
  startAllServices();
  const client = getClient(options.sessionId);
  if (!client) {
    console.error(`${LOG_PREFIX} 无法获取 WA client`);
    process.exit(1);
  }
  try {
    await waitForReady(120000, options.sessionId);
    console.log(`${LOG_PREFIX} WhatsApp 就绪`);
  } catch (e) {
    console.error(`${LOG_PREFIX} WA client 就绪失败: ${e.message}`);
    process.exit(1);
  }

  // 查找需要补充的消息
  const messages = findMissingMediaMessages(db, options);
  console.log(`${LOG_PREFIX} 找到 ${messages.length} 条需要补充媒体的消息`);

  if (messages.length === 0) {
    console.log(`${LOG_PREFIX} 无需补充，退出`);
    return;
  }

  // 分批处理
  let totalSuccess = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (let i = 0; i < messages.length; i += options.batchSize) {
    const batch = messages.slice(i, i + options.batchSize);
    console.log(`\n${LOG_PREFIX} 处理批次 ${Math.floor(i / options.batchSize) + 1} (${batch.length} 条)`);
    const results = await processBatch(client, db, batch, options);
    totalSuccess += results.success;
    totalFailed += results.failed;
    totalSkipped += results.skipped;

    if (i + options.batchSize < messages.length) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`\n${LOG_PREFIX} 完成: success=${totalSuccess}, failed=${totalFailed}, skipped=${totalSkipped}`);
}

main(process.argv.slice(2)).catch(err => {
  console.error(`${LOG_PREFIX} fatal:`, err);
  process.exit(1);
});
