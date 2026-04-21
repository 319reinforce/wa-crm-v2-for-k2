#!/usr/bin/env node
/**
 * retry-failed-media.cjs
 *
 * 重试 wa_messages 中媒体下载失败的消息。
 * 适用于: real-time handler 下载失败、poll 过程中断 等情况。
 *
 * 用法:
 *   node scripts/retry-failed-media.cjs                        # 重试所有失败消息
 *   node scripts/retry-failed-media.cjs --dry-run             # 仅预览，不实际下载
 *   node scripts/retry-failed-media.cjs --creator-id=3320    # 仅指定 creator
 *   node scripts/retry-failed-media.cjs --limit=20            # 限制数量
 *   node scripts/retry-failed-media.cjs --status=failed       # 只重试 failed (默认)
 *   node scripts/retry-failed-media.cjs --status=pending      # 重试 pending
 *   node scripts/retry-failed-media.cjs --session=3000       # 指定 WA session
 */

'use strict';

const path = require('path');

process.chdir(path.resolve(__dirname, '..'));

const { initDb, getDb } = require('../db');
const { startAllServices, getClient, waitForReady } = require('../server/services/waService');

const LOG_PREFIX = '[retry-failed-media]';

function parseArgs(argv) {
  const options = {
    dryRun: false,
    creatorId: null,
    limit: 100,
    status: 'failed',
    batchSize: 5,
    sessionId: null,
  };
  for (const entry of argv) {
    if (entry === '--dry-run') { options.dryRun = true; continue; }
    if (entry.startsWith('--creator-id=')) { options.creatorId = parseInt(entry.slice(13), 10) || null; continue; }
    if (entry.startsWith('--limit=')) { options.limit = parseInt(entry.slice(8), 10) || 100; continue; }
    if (entry.startsWith('--status=')) { options.status = entry.slice(9).trim(); continue; }
    if (entry.startsWith('--batch-size=')) { options.batchSize = parseInt(entry.slice(13), 10) || 5; continue; }
    if (entry.startsWith('--session=')) { options.sessionId = entry.slice(10).trim() || null; continue; }
  }
  if (!['failed', 'pending', 'all'].includes(options.status)) {
    options.status = 'failed';
  }
  return options;
}

async function findFailedMediaMessages(db, options) {
  let sql = `
    SELECT m.id, m.creator_id, m.timestamp, m.text,
           c.wa_phone, c.primary_name
    FROM wa_messages m
    JOIN creators c ON c.id = m.creator_id
    WHERE m.media_download_status = ?
  `;
  const params = [options.status];

  if (options.creatorId) {
    sql += ' AND m.creator_id = ?';
    params.push(options.creatorId);
  }

  sql += ' ORDER BY m.timestamp DESC LIMIT ?';
  params.push(options.limit);

  return db.prepare(sql).all(...params);
}

async function fetchRawMessage(client, chatWid, msgId) {
  if (!client?.pupPage) return null;
  try {
    return await client.pupPage.evaluate(async (targetChatWid, targetMsgId) => {
      const chatModel = window.Store.Chat.get(targetChatWid);
      if (!chatModel) return null;
      const msg = chatModel.msgs?.getModel(targetMsgId) ?? null;
      if (!msg) return null;
      // 返回原始对象（有 downloadMedia 方法）
      return {
        _id: msg.id?._serialized || msg.id?.id || targetMsgId,
        hasMedia: msg.hasMedia,
        mimetype: msg.mimetype,
        width: msg.width,
        height: msg.height,
        body: msg.body,
        caption: msg.caption,
        thumbnailUrl: msg.thumbnailUrl,
        _raw: msg, // 原始 Message 对象（仅在 eval 内有效）
      };
    }, chatWid, msgId);
  } catch (e) {
    console.warn(`${LOG_PREFIX} fetchRawMessage failed: ${e.message}`);
    return null;
  }
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

async function processBatch(client, db, messages, options) {
  const results = { success: 0, failed: 0, skipped: 0 };

  for (const msg of messages) {
    if (!msg.wa_phone) { results.skipped++; continue; }

    if (options.dryRun) {
      console.log(`  [dry-run] would retry msg #${msg.id} (creator=${msg.creator_id}, phone=${maskPhone(msg.wa_phone)}, text=${String(msg.text || '').slice(0, 30)})`);
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

    // 2. 获取原始消息对象
    const raw = await fetchRawMessage(client, chatWid, null);
    if (!raw) {
      // 消息不在内存中（已被清理），跳过并标记为 failed
      console.warn(`  skip msg #${msg.id}: message not in memory`);
      await updateMessageMediaInfo(db, msg.id, null);
      results.failed++;
      continue;
    }

    // 3. 下载媒体
    let mediaInfo = null;
    if (raw._raw?.hasMedia) {
      try {
        const { downloadAndStoreIncomingMedia } = require('../server/services/waIncomingMediaService');
        mediaInfo = await downloadAndStoreIncomingMedia(raw._raw, {
          creatorId: msg.creator_id,
          operator: process.env.WA_OWNER || 'Beau',
        });
      } catch (e) {
        console.warn(`  download failed for msg #${msg.id}: ${e.message}`);
      }
    }

    // 4. 更新数据库
    await updateMessageMediaInfo(db, msg.id, mediaInfo);
    if (mediaInfo) {
      console.log(`  ✅ msg #${msg.id}: media downloaded (asset=${mediaInfo.mediaAssetId})`);
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

function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length <= 4) return '***';
  return `***${digits.slice(-4)}`;
}

async function main(argv) {
  const options = parseArgs(argv);
  console.log(`${LOG_PREFIX} 启动 (dry-run=${options.dryRun}, status=${options.status}, limit=${options.limit}, batch=${options.batchSize}, session=${options.sessionId || 'default'})`);

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

  // 查找需要重试的消息
  const messages = findFailedMediaMessages(db, options);
  console.log(`${LOG_PREFIX} 找到 ${messages.length} 条 status=${options.status} 的消息`);

  if (messages.length === 0) {
    console.log(`${LOG_PREFIX} 无需重试，退出`);
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
