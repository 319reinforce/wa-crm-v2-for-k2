/**
 * WorkerStatusBar — WA Worker 可视化进度条
 * 双形态：收缩（小方块只显示状态点）/ 展开（完整信息）
 * 拖拽位置记忆到 localStorage
 */
import React, { useState, useEffect, useRef } from 'react'

const API_BASE = '/api'
const POLL_INTERVAL_MS = 5 * 60 * 1000   // 5分钟，与 waWorker.js 保持一致

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

const COLLAPSED_SIZE = 48

export function WorkerStatusBar() {
    const [status, setStatus] = useState(null)
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
        const fetchStatus = async () => {
            try {
                const res = await fetch(`${API_BASE}/wa-worker/status`)
                const data = await res.json()
                setStatus(data)
                setVisible(data.phase !***REMOVED*** 'idle')
                if (data.phase ***REMOVED***= 'live') pollTickRef.current = 0
            } catch (_) {}
        }
        fetchStatus()
        const id = setInterval(fetchStatus, 5000)
        return () => clearInterval(id)
    }, [])

    // 轮询 WhatsApp 状态和二维码（每5秒）
    useEffect(() => {
        const fetchWaStatus = async () => {
            try {
                const res = await fetch(`${API_BASE}/wa/status`)
                const data = await res.json()
                setWaStatus(data)
                if (data.hasQr) {
                    setVisible(true)
                    // 获取 QR 图片
                    try {
                        const qrRes = await fetch(`${API_BASE}/wa/qr`)
                        const qrData = await qrRes.json()
                        if (qrData.qr) setQrDataUrl(qrData.qr)
                    } catch (_) {}
                } else if (data.ready) {
                    setExpanded(false)  // 已就绪，收起面板
                }
            } catch (_) {}
        }
        fetchWaStatus()
        const id = setInterval(fetchWaStatus, 5000)
        return () => clearInterval(id)
    }, [])

    // 每秒递增 tick（用于倒计时）
    useEffect(() => {
        if (!visible || !status || status.phase !***REMOVED*** 'live') return
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
    const pct = typeof safeStatus.progressPct ***REMOVED***= 'function' ? safeStatus.progressPct() : (safeStatus.progressPct || 0)
    const color = status ? phaseColor(status.phase) : '#94a3b8'

    // 计算距下次轮询的倒计时
    let secondsUntilNextPoll = null
    if (status?.lastPollAt) {
        const secondsSinceLastPoll = Math.floor((Date.now() - new Date(status.lastPollAt).getTime()) / 1000)
        secondsUntilNextPoll = Math.max(0, Math.round(POLL_INTERVAL_MS / 1000) - secondsSinceLastPoll)
    }

    // ***REMOVED***= 收缩形态：小方块 ***REMOVED***=
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

    // ***REMOVED***= 展开形态：完整面板 ***REMOVED***=
    return (
        <div
            style={{
                position: 'fixed',
                bottom: pos.bottom,
                right: pos.right,
                width: 300,
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

                {/* 增量轮询倒计时 */}
                {status?.phase ***REMOVED***= 'live' && secondsUntilNextPoll != null && (
                    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, height: 4, background: '#f3f4f6', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{
                                height: '100%',
                                width: `${Math.round((1 - secondsUntilNextPoll / (POLL_INTERVAL_MS / 1000)) * 100)}%`,
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
