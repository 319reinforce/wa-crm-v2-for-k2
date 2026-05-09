import { useCallback, useState } from 'react'
import { fetchJsonOrThrow } from '../utils/api'

const API_BASE = '/api'

export default function useOwnerTransfer({
  creatorsCacheRef,
  filterOwner,
  loadData,
  setFilterOwner,
  setManualForm,
  setSelectedCreatorIds,
} = {}) {
  const [transferPreview, setTransferPreview] = useState(null)
  const [transferLoading, setTransferLoading] = useState(false)
  const [transferExecuting, setTransferExecuting] = useState(false)
  const [transferError, setTransferError] = useState('')

  const clearTransferPreview = useCallback(() => {
    setTransferPreview(null)
  }, [])

  const loadTransferPreview = useCallback(async ({ fromOwner = '', toOwner = 'Yiyun' } = {}) => {
    const from = String(fromOwner || '').trim()
    const to = String(toOwner || '').trim()
    if (!from || !to) {
      setTransferError('请选择来源和目标 owner')
      return null
    }
    setTransferLoading(true)
    setTransferError('')
    try {
      const params = new URLSearchParams({ from, to })
      const res = await fetchJsonOrThrow(`${API_BASE}/operator-roster/transfer-preview?${params.toString()}`)
      const data = res?.data || null
      setTransferPreview(data)
      return data
    } catch (error) {
      setTransferError(error.message || '读取迁移预览失败')
      return null
    } finally {
      setTransferLoading(false)
    }
  }, [])

  const executeTransfer = useCallback(async ({ fromOwner = '', toOwner = 'Yiyun' } = {}) => {
    const preview = transferPreview || await loadTransferPreview({ fromOwner, toOwner })
    if (!preview) return
    const confirmed = window.confirm(
      `确认将 ${preview.from_owner} 的 ${preview.creator_count || 0} 位联系人迁移到 ${preview.to_owner}？\n\n同时会更新 ${preview.roster_count || 0} 条 roster 归属和 ${preview.event_count || 0} 条事件归属；历史消息不会删除。`
    )
    if (!confirmed) return
    setTransferExecuting(true)
    setTransferError('')
    try {
      const res = await fetchJsonOrThrow(`${API_BASE}/operator-roster/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromOwner, to: toOwner, confirm: true }),
      })
      const nextOwner = res?.data?.to_owner || toOwner
      creatorsCacheRef?.current?.clear?.()
      setFilterOwner?.(nextOwner)
      setManualForm?.((prev) => ({ ...prev, owner: nextOwner }))
      setSelectedCreatorIds?.([])
      setTransferPreview(null)
      if (nextOwner === filterOwner) await loadData?.()
      window.alert(`已迁移 ${res?.data?.creators_updated || 0} 位联系人到 ${nextOwner}`)
    } catch (error) {
      setTransferError(error.message || '迁移失败')
    } finally {
      setTransferExecuting(false)
    }
  }, [
    creatorsCacheRef,
    filterOwner,
    loadData,
    loadTransferPreview,
    setFilterOwner,
    setManualForm,
    setSelectedCreatorIds,
    transferPreview,
  ])

  return {
    transferPreview,
    transferLoading,
    transferExecuting,
    transferError,
    clearTransferPreview,
    loadTransferPreview,
    executeTransfer,
  }
}
