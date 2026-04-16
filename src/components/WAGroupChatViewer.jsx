import React, { useEffect, useState } from 'react'
import { fetchWaAdmin } from '../utils/waAdmin'
import WA from '../utils/waTheme'

function formatMessageTime(timestamp) {
  const ts = Number(timestamp) || 0
  if (!ts) return ''
  const date = new Date(ts)
  return date.toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function WAGroupChatViewer({ groupChat, apiBase = '/api' }) {
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!groupChat?.id) {
        setMessages([])
        return
      }
      setLoading(true)
      setError('')
      try {
        const res = await fetchWaAdmin(`${apiBase}/wa/groups/${groupChat.id}/messages?limit=200`)
        const data = await res.json()
        if (!res.ok) {
          throw new Error(data?.error || `HTTP ${res.status}`)
        }
        if (!cancelled) {
          setMessages(Array.isArray(data?.messages) ? data.messages : [])
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || '群聊消息加载失败')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [groupChat?.id, apiBase])

  if (!groupChat) {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: WA.chatBg }}>
        <div className="text-center" style={{ color: WA.textMuted }}>
          <div className="text-lg font-semibold">选择一个群聊</div>
          <div className="text-sm mt-2">群聊消息会单独展示，不再混入达人私聊。</div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col min-h-0" style={{ background: WA.chatBg }}>
      <div className="shrink-0 px-6 py-4 border-b" style={{ borderColor: WA.borderLight, background: WA.white }}>
        <div className="text-xs uppercase tracking-[0.18em]" style={{ color: WA.textMuted }}>Group Archive</div>
        <div className="mt-1 text-2xl font-semibold" style={{ color: WA.textDark }}>{groupChat.group_name}</div>
        <div className="mt-2 flex items-center gap-4 text-xs" style={{ color: WA.textMuted }}>
          <span>Session {groupChat.session_id || 'unknown'}</span>
          <span>{groupChat.msg_count || 0} 条消息</span>
          <span>{formatMessageTime(groupChat.last_active)}</span>
        </div>
        <div
          className="mt-3 rounded-xl px-3 py-2 text-xs"
          style={{ background: '#fff7ed', color: '#9a3412', border: '1px solid #fdba74' }}
        >
          群聊归档为只读视图。群聊发送功能默认永久禁用，除非人工连续两次明确确认“同意启用群聊”后再单独解锁。
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {loading ? (
          <div className="text-sm" style={{ color: WA.textMuted }}>群聊消息加载中...</div>
        ) : error ? (
          <div className="text-sm" style={{ color: '#b91c1c' }}>{error}</div>
        ) : messages.length === 0 ? (
          <div className="text-sm" style={{ color: WA.textMuted }}>这个群聊暂时还没有归档消息。</div>
        ) : (
          messages.map((message) => {
            const mine = message.role === 'me'
            return (
              <div
                key={message.id}
                className={`max-w-[78%] rounded-2xl px-4 py-3 ${mine ? 'ml-auto' : ''}`}
                style={{
                  background: mine ? '#dcf8c6' : WA.white,
                  border: `1px solid ${WA.borderLight}`,
                  boxShadow: '0 6px 18px rgba(15, 23, 42, 0.05)',
                }}
              >
                <div className="flex items-center justify-between gap-3 text-[11px] mb-1.5" style={{ color: WA.textMuted }}>
                  <span>{mine ? '我' : (message.author_name || message.author_phone || '群成员')}</span>
                  <span>{formatMessageTime(message.timestamp)}</span>
                </div>
                <div className="text-sm whitespace-pre-wrap leading-6" style={{ color: WA.textDark }}>
                  {message.text}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
