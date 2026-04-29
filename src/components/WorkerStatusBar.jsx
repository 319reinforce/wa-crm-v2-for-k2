/**
 * WorkerStatusBar — WA Worker 可视化进度条
 * 双形态：收缩（小方块只显示状态点）/ 展开（完整信息）
 * 拖拽位置记忆到 localStorage
 */
import React, { useState, useEffect, useRef } from 'react'
import { fetchAppAuth } from '../utils/appAuth'
import { fetchWaAdmin } from '../utils/waAdmin'

const API_BASE = '/api'
const DEFAULT_POLL_INTERVAL_MS = 60 * 1000

function phaseLabel(phase) {
    switch (phase) {
        case 'idle':   return '未启动'
        case 'init':   return '初始化'
        case 'sync':   return '同步中'
        case 'live':   return '实时监控'
        default:       return phase
    }
}

function phaseColor(phase) {
    switch (phase) {
        case 'idle':   return '#94a3b8'
        case 'init':   return '#f59e0b'
        case 'sync':   return '#3b82f6'
        case 'live':   return '#10b981'
        default:       return '#94a3b8'
    }
}

function ProgressBar({ pct, color }) {
    const filled = Math.round(pct / 5)
    const empty  = 20 - filled
    return (
        <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
            <span style={{ color }}>{'█'.repeat(filled)}</span>
            <span style={{ color: '#e5e7eb' }}>{'░'.repeat(empty)}</span>
        </span>
    )
}

function formatShortTime(ts) {
    const n = Number(ts || 0)
    if (!Number.isFinite(n) || n <= 0) return '无时间'
    const d = new Date(n)
    const now = Date.now()
    const diffHours = Math.floor((now - n) / 3600000)
    if (diffHours < 1) return '刚刚'
    if (diffHours < 24) return `${diffHours}小时前`
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

const COLLAPSED_SIZE = 48

export function WorkerStatusBar() {
    const [status, setStatus] = useState(null)
    const [contactStatus, setContactStatus] = useState(null)
    const [confirmingCreatorId, setConfirmingCreatorId] = useState(null)
    const [waStatus, setWaStatus] = useState(null)  // { ready, hasQr }
    const [qrDataUrl, setQrDataUrl] = useState(null)
    const [visible, setVisible] = useState(false)
    const [expanded, setExpanded] = useState(false)
    const [dragging, setDragging] = useState(false)
    const [pos, setPos] = useState(() => {
        try {
            const saved = localStorage.getItem('wa_worker_pos')
            if (saved) return JSON.parse(saved)
        } catch (_) {}
        return { bottom: 16, right: 16 }
    })
    const dragStart = useRef(null)
    const posRef = useRef(pos)
    const barRef = useRef(null)
    const pollTickRef = useRef(0)   // 每秒递增，计算距上次轮询的秒数

    posRef.current = pos

    // 轮询 worker 状态（每5秒）
    useEffect(() => {
        let cancelled = false
        const fetchContactStatus = async () => {
            try {
                const res = await fetchAppAuth(`${API_BASE}/wa-worker/contact-status?days=3`)
                if (!res.ok) return
                const data = await res.json()
                if (!cancelled) setContactStatus(data)
            } catch (_) {}
        }
        const fetchStatus = async () => {
            try {
                const res = await fetchAppAuth(`${API_BASE}/wa-worker/status`)
                const data = await res.json()
                setStatus(data)
                setVisible(data.phase !== 'idle')
                if (data.phase === 'live') pollTickRef.current = 0
                fetchContactStatus()
            } catch (_) {}
        }
        fetchStatus()
        const id = setInterval(fetchStatus, 30000)
        return () => {
            cancelled = true
            clearInterval(id)
        }
    }, [])

    // 轮询 WhatsApp 状态和二维码（每5秒）
    useEffect(() => {
        const fetchWaStatus = async () => {
            try {
                const res = await fetchWaAdmin(`${API_BASE}/wa/status`)
                if (!res.ok) {
                    setWaStatus(null)
                    setQrDataUrl(null)
                    return
                }
                const data = await res.json()
                setWaStatus(data)
                if (data.hasQr) {
                    setVisible(true)
                    // 获取 QR 图片
                    try {
                        const qrRes = await fetchWaAdmin(`${API_BASE}/wa/qr`)
                        if (!qrRes.ok) {
                            setQrDataUrl(null)
                            return
                        }
                        const qrData = await qrRes.json()
                        if (qrData.qr) setQrDataUrl(qrData.qr)
                    } catch (_) {}
                } else {
                    setQrDataUrl(null)
                    if (data.ready) {
                        setExpanded(false)  // 已就绪，收起面板
                    }
                }
            } catch (_) {
                setWaStatus(null)
                setQrDataUrl(null)
            }
        }
        fetchWaStatus()
        const id = setInterval(fetchWaStatus, 30000)
        const handler = () => fetchWaStatus()
        window.addEventListener('wa-session-status-changed', handler)
        return () => {
            clearInterval(id)
            window.removeEventListener('wa-session-status-changed', handler)
        }
    }, [])

    // 每秒递增 tick（用于倒计时）
    useEffect(() => {
        if (!visible || !status || status.phase !== 'live') return
        const id = setInterval(() => {
            pollTickRef.current += 1
        }, 1000)
        return () => clearInterval(id)
    }, [visible, status])

    // 拖拽
    useEffect(() => {
        if (!dragging) return
        const onMove = (e) => {
            const clientX = e.touches ? e.touches[0].clientX : e.clientX
            const clientY = e.touches ? e.touches[0].clientY : e.clientY
            const dx = clientX - dragStart.current.x
            const dy = clientY - dragStart.current.y
            const newPos = {
                bottom: Math.max(0, posRef.current.bottom - dy),
                right: Math.max(0, posRef.current.right - dx),
            }
            dragStart.current = { x: clientX, y: clientY }
            setPos(newPos)
        }
        const onUp = () => {
            setDragging(false)
            try { localStorage.setItem('wa_worker_pos', JSON.stringify(posRef.current)) } catch (_) {}
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        window.addEventListener('touchmove', onMove)
        window.addEventListener('touchend', onUp)
        return () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
            window.removeEventListener('touchmove', onMove)
            window.removeEventListener('touchend', onUp)
        }
    }, [dragging])

    // 只要 visible=true 或者有 QR，就渲染（允许 loading 状态）
    if (!visible && !waStatus?.hasQr) return null

    // status 允许为 null（初始化阶段），所有引用加 optional chaining 或默认值
    const safeStatus = status || {}
    const pct = typeof safeStatus.progressPct === 'function' ? safeStatus.progressPct() : (safeStatus.progressPct || 0)
    const color = status ? phaseColor(status.phase) : '#94a3b8'

    const effectivePollIntervalMs = status?.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS
    const contacts = Array.isArray(contactStatus?.contacts) ? contactStatus.contacts : []
    const ownerSummaries = Array.isArray(contactStatus?.owners) ? contactStatus.owners : []
    const unconfirmedCount = contacts.filter((item) => !item.confirmed).length
    const visibleContacts = contacts
        .slice()
        .sort((a, b) => {
            if (a.confirmed !== b.confirmed) return a.confirmed ? 1 : -1
            return Number(b.latest_message_at || 0) - Number(a.latest_message_at || 0)
        })
        .slice(0, 80)

    const refreshContactStatus = async () => {
        const res = await fetchAppAuth(`${API_BASE}/wa-worker/contact-status?days=3`)
        if (!res.ok) return
        setContactStatus(await res.json())
    }

    const confirmContact = async (contact) => {
        if (!contact?.creator_id || contact.confirmed) return
        setConfirmingCreatorId(contact.creator_id)
        try {
            const res = await fetchAppAuth(`${API_BASE}/wa-worker/contact-status/${contact.creator_id}/confirm`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirmed_through_ts: contact.latest_message_at }),
            })
            if (res.ok) await refreshContactStatus()
        } finally {
            setConfirmingCreatorId(null)
        }
    }

    // 计算距下次轮询的倒计时
    let secondsUntilNextPoll = null
    if (status?.lastPollAt) {
        const secondsSinceLastPoll = Math.floor((Date.now() - new Date(status.lastPollAt).getTime()) / 1000)
        secondsUntilNextPoll = Math.max(0, Math.round(effectivePollIntervalMs / 1000) - secondsSinceLastPoll)
    }

    // === 收缩形态：小方块 ===
    if (!expanded) {
        return (
            <div
                ref={barRef}
                onClick={() => setExpanded(true)}
                onMouseDown={(e) => {
                    e.stopPropagation()
                    setDragging(true)
                    dragStart.current = { x: e.clientX, y: e.clientY }
                }}
                onTouchStart={(e) => {
                    e.stopPropagation()
                    setDragging(true)
                    dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
                }}
                style={{
                    position: 'fixed',
                    bottom: pos.bottom,
                    right: pos.right,
                    width: COLLAPSED_SIZE,
                    height: COLLAPSED_SIZE,
                    borderRadius: 12,
                    background: '#fff',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                    zIndex: 9999,
                    cursor: dragging ? 'grabbing' : 'grab',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                <span style={{
                    width: 14, height: 14, borderRadius: '50%',
                    background: color,
                    boxShadow: `0 0 8px ${color}`,
                    flexShrink: 0,
                }} />
            </div>
        )
    }

    // === 展开形态：完整面板 ===
    return (
        <div
            style={{
                position: 'fixed',
                bottom: pos.bottom,
                right: pos.right,
                width: 380,
                zIndex: 9999,
                background: '#fff',
                borderRadius: 12,
                boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                overflow: 'hidden',
                fontSize: 12,
            }}
        >
            {/* Header / drag handle */}
            <div
                onClick={() => setExpanded(false)}
                onMouseDown={(e) => {
                    e.stopPropagation()
                    setDragging(true)
                    dragStart.current = { x: e.clientX, y: e.clientY }
                }}
                onTouchStart={(e) => {
                    e.stopPropagation()
                    setDragging(true)
                    dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
                }}
                style={{
                    padding: '8px 12px',
                    background: '#f8f9fa',
                    borderBottom: '1px solid #e5e7eb',
                    cursor: dragging ? 'grabbing' : 'grab',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    userSelect: 'none',
                }}
            >
                <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: color, flexShrink: 0,
                    boxShadow: `0 0 4px ${color}`,
                }} />
                <span style={{ fontWeight: 600, color: '#374151', flex: 1 }}>WA Worker</span>
                {unconfirmedCount > 0 && (
                    <span style={{
                        padding: '1px 6px',
                        borderRadius: 20,
                        fontSize: 10,
                        fontWeight: 700,
                        background: '#fff7ed',
                        color: '#c2410c',
                    }}>
                        待确认 {unconfirmedCount}
                    </span>
                )}
                <span style={{
                    padding: '1px 7px', borderRadius: 20, fontSize: 10, fontWeight: 600,
                    background: `${color}22`, color,
                }}>
                    {phaseLabel(safeStatus.phase)}
                </span>
                <span style={{ color: '#9ca3af', fontSize: 10 }}>▼</span>
            </div>

            {/* Progress line */}
            <div style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <ProgressBar pct={pct} color={color} />
                <span style={{ color: '#6b7280', fontSize: 11, flexShrink: 0 }}>{pct}%</span>
            </div>

            {/* QR 码扫码区域 */}
            {waStatus?.hasQr && (
                <div style={{ padding: '8px 12px', borderBottom: '1px solid #f3f4f6', textAlign: 'center' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#ef4444', marginBottom: 6 }}>
                        ⚠️ 请扫码认证 WhatsApp
                    </div>
                    {qrDataUrl ? (
                        <img
                            src={qrDataUrl}
                            alt="WhatsApp QR"
                            style={{ width: 180, height: 180, borderRadius: 8, border: '1px solid #e5e7eb' }}
                        />
                    ) : (
                        <div style={{ width: 180, height: 180, margin: '0 auto', background: '#f9fafb', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 11 }}>
                            加载中...
                        </div>
                    )}
                    <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>
                        WhatsApp → ⋮ → 已关联的设备 → 关联新设备
                    </div>
                </div>
            )}

            {/* Details */}
            <div style={{ padding: '0 12px 10px', color: '#6b7280', fontSize: 11 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: safeStatus.clientReady ? '#10b981' : '#ef4444', flexShrink: 0 }} />
                    <span style={{ fontWeight: 500, color: '#374151' }}>Beau</span>
                    <span style={{ color: safeStatus.clientReady ? '#10b981' : '#ef4444' }}>
                        {safeStatus.clientReady ? '在线' : (safeStatus.clientError ? '错误' : '离线')}
                    </span>
                </div>

                <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <div style={{ background: '#f9fafb', borderRadius: 6, padding: '4px 8px' }}>
                        <div style={{ color: '#9ca3af', fontSize: 10 }}>新消息</div>
                        <div style={{ fontWeight: 700, color: '#374151', fontSize: 14 }}>+{safeStatus.newMessages || 0}</div>
                    </div>
                    <div style={{ background: '#f9fafb', borderRadius: 6, padding: '4px 8px' }}>
                        <div style={{ color: '#9ca3af', fontSize: 10 }}>同步进度</div>
                        <div style={{ fontWeight: 700, color: '#374151', fontSize: 14 }}>
                            {safeStatus.processedChats || 0}/{safeStatus.totalChats || 0}
                        </div>
                    </div>
                </div>

                {ownerSummaries.length > 0 && (
                    <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {ownerSummaries.map((item) => (
                            <span
                                key={item.owner}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    padding: '2px 7px',
                                    borderRadius: 999,
                                    background: item.unconfirmed > 0 ? '#fff7ed' : '#ecfdf5',
                                    color: item.unconfirmed > 0 ? '#c2410c' : '#047857',
                                    fontSize: 10,
                                    fontWeight: 700,
                                }}
                            >
                                {item.owner} {item.confirmed}/{item.total}
                            </span>
                        ))}
                    </div>
                )}

                <div style={{ marginTop: 10, borderTop: '1px solid #f3f4f6', paddingTop: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <div style={{ color: '#374151', fontSize: 11, fontWeight: 700 }}>近3天新消息联系人</div>
                        <button
                            type="button"
                            onClick={refreshContactStatus}
                            style={{
                                border: '1px solid #e5e7eb',
                                background: '#fff',
                                color: '#64748b',
                                borderRadius: 999,
                                padding: '2px 8px',
                                fontSize: 10,
                                cursor: 'pointer',
                            }}
                        >
                            刷新
                        </button>
                    </div>
                    {visibleContacts.length === 0 ? (
                        <div style={{ color: '#9ca3af', fontSize: 10, padding: '8px 0' }}>暂无近3天新消息</div>
                    ) : (
                        <div style={{ maxHeight: 260, overflowY: 'auto', paddingRight: 2 }}>
                            {visibleContacts.map((item) => {
                                const crawlStatus = item.crawl?.status || 'waiting'
                                const crawlColor = crawlStatus === 'error'
                                    ? '#dc2626'
                                    : crawlStatus === 'checked'
                                        ? '#047857'
                                        : '#64748b'
                                return (
                                    <div
                                        key={`${item.owner}:${item.creator_id}`}
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: '1fr auto',
                                            gap: 8,
                                            alignItems: 'center',
                                            padding: '7px 0',
                                            borderTop: '1px solid #f8fafc',
                                        }}
                                    >
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                                <span style={{
                                                    width: 6,
                                                    height: 6,
                                                    borderRadius: '50%',
                                                    background: item.confirmed ? '#10b981' : '#f59e0b',
                                                    flexShrink: 0,
                                                }} />
                                                <span style={{ color: '#111827', fontSize: 11, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {item.name}
                                                </span>
                                            </div>
                                            <div style={{ marginTop: 2, display: 'flex', gap: 6, flexWrap: 'wrap', color: '#94a3b8', fontSize: 10 }}>
                                                <span>{item.owner}</span>
                                                <span>{formatShortTime(item.latest_message_at)}</span>
                                                <span>{item.recent_message_count} 条</span>
                                                <span style={{ color: crawlColor }}>
                                                    {crawlStatus === 'checked' ? '已爬取' : crawlStatus === 'error' ? '爬取错误' : '待爬取'}
                                                </span>
                                                {item.crawl?.inserted_count > 0 && <span style={{ color: '#047857' }}>+{item.crawl.inserted_count}</span>}
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => confirmContact(item)}
                                            disabled={item.confirmed || confirmingCreatorId === item.creator_id}
                                            title={item.confirmed ? '已确认到最新消息' : '确认这位联系人已检查'}
                                            style={{
                                                width: 28,
                                                height: 28,
                                                borderRadius: 999,
                                                border: `1px solid ${item.confirmed ? '#bbf7d0' : '#fed7aa'}`,
                                                background: item.confirmed ? '#ecfdf5' : '#fff7ed',
                                                color: item.confirmed ? '#047857' : '#c2410c',
                                                fontWeight: 800,
                                                cursor: item.confirmed ? 'default' : 'pointer',
                                                opacity: confirmingCreatorId === item.creator_id ? 0.65 : 1,
                                            }}
                                        >
                                            ✓
                                        </button>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>

                {/* 增量轮询倒计时 */}
                {status?.phase === 'live' && secondsUntilNextPoll != null && (
                    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, height: 4, background: '#f3f4f6', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{
                                height: '100%',
                                width: `${Math.round((1 - secondsUntilNextPoll / (effectivePollIntervalMs / 1000)) * 100)}%`,
                                background: secondsUntilNextPoll < 30 ? '#f59e0b' : '#3b82f6',
                                borderRadius: 2,
                                transition: 'width 1s linear',
                            }} />
                        </div>
                        <span style={{ color: secondsUntilNextPoll < 30 ? '#f59e0b' : '#9ca3af', fontSize: 10, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                            {secondsUntilNextPoll < 60 ? `${secondsUntilNextPoll}秒` : `${Math.floor(secondsUntilNextPoll / 60)}分${secondsUntilNextPoll % 60 > 0 ? (secondsUntilNextPoll % 60) + '秒' : ''}`}
                        </span>
                    </div>
                )}

                {safeStatus?.lastPollAt && (
                    <div style={{ marginTop: 4, color: '#9ca3af', fontSize: 10 }}>
                        上次轮询: {new Date(safeStatus.lastPollAt).toLocaleTimeString('zh-CN')}
                    </div>
                )}

                {safeStatus.errors && safeStatus.errors.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                        <div style={{ color: '#ef4444', fontSize: 10, fontWeight: 600 }}>错误 {safeStatus.errors.length}</div>
                        {safeStatus.errors.slice(0, 3).map((e, i) => (
                            <div key={i} style={{ color: '#ef4444', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                • {e}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
