import { useEffect, useState, useCallback, useRef } from 'react'
import { fetchJsonOrThrow } from '../utils/api'

const API_BASE = '/api'

export function useCreators({ search = '', owner = '' } = {}) {
  const [creators, setCreators] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const abortRef = useRef(null)

  const load = useCallback(async () => {
    let controller = null
    setLoading(true)
    setError('')
    try {
      if (abortRef.current) abortRef.current.abort()
      controller = new AbortController()
      abortRef.current = controller
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (owner) params.set('owner', owner)
      const list = await fetchJsonOrThrow(`${API_BASE}/creators?${params.toString()}`, {
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      const enriched = list.map(c => ({ ...c, _full: buildCreatorListFull(c) }))
      enriched.sort((a, b) => getLastTs(b) - getLastTs(a))
      setCreators(enriched)
    } catch (err) {
      if (controller?.signal.aborted) return
      setError(err?.message || '加载达人列表失败')
    } finally {
      if (controller && abortRef.current === controller && !controller.signal.aborted) {
        setLoading(false)
      }
    }
  }, [search, owner])

  useEffect(() => {
    load()
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
  }, [load])

  return { creators, loading, error, reload: load }
}

export function useCreatorDetail(id) {
  const [creator, setCreator] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const abortRef = useRef(null)

  const load = useCallback(async () => {
    if (!id) {
      setLoading(false)
      setError('无效的达人 ID')
      return
    }
    let controller = null
    setLoading(true)
    setError('')
    try {
      if (abortRef.current) abortRef.current.abort()
      controller = new AbortController()
      abortRef.current = controller
      const detail = await fetchJsonOrThrow(`${API_BASE}/creators/${id}`, { signal: controller.signal })
      if (controller.signal.aborted) return
      setCreator(detail)
    } catch (err) {
      if (controller?.signal.aborted) return
      setCreator(null)
      setError(err?.message || '加载达人详情失败')
    } finally {
      if (abortRef.current === controller && !controller.signal.aborted) {
        setLoading(false)
      }
    }
  }, [id])

  useEffect(() => {
    load()
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
  }, [load])

  return { creator, loading, error, reload: load }
}

function buildCreatorListFull(detail = {}) {
  const joinbrands = {
    ...(detail.joinbrands || {}),
    ev_joined: detail.ev_joined ?? detail.joinbrands?.ev_joined,
    ev_ready_sent: detail.ev_ready_sent ?? detail.joinbrands?.ev_ready_sent,
    ev_trial_7day: detail.ev_trial_7day ?? detail.joinbrands?.ev_trial_7day,
    ev_trial_active: detail.ev_trial_active ?? detail.joinbrands?.ev_trial_active,
    ev_monthly_invited: detail.ev_monthly_invited ?? detail.joinbrands?.ev_monthly_invited,
    ev_monthly_started: detail.ev_monthly_started ?? detail.joinbrands?.ev_monthly_started,
    ev_monthly_joined: detail.ev_monthly_joined ?? detail.joinbrands?.ev_monthly_joined,
    ev_whatsapp_shared: detail.ev_whatsapp_shared ?? detail.joinbrands?.ev_whatsapp_shared,
    ev_gmv_1k: detail.ev_gmv_1k ?? detail.joinbrands?.ev_gmv_1k,
    ev_gmv_2k: detail.ev_gmv_2k ?? detail.joinbrands?.ev_gmv_2k,
    ev_gmv_5k: detail.ev_gmv_5k ?? detail.joinbrands?.ev_gmv_5k,
    ev_gmv_10k: detail.ev_gmv_10k ?? detail.joinbrands?.ev_gmv_10k,
    ev_agency_bound: detail.ev_agency_bound ?? detail.joinbrands?.ev_agency_bound,
    ev_churned: detail.ev_churned ?? detail.joinbrands?.ev_churned,
  }

  const wacrm = {
    ...(detail.wacrm || {}),
    beta_status: detail.beta_status ?? detail.wacrm?.beta_status,
    priority: detail.priority ?? detail.wacrm?.priority,
    agency_bound: detail.agency_bound ?? detail.wacrm?.agency_bound,
    monthly_fee_status: detail.monthly_fee_status ?? detail.wacrm?.monthly_fee_status,
    video_count: detail.video_count ?? detail.wacrm?.video_count,
    video_target: detail.video_target ?? detail.wacrm?.video_target,
    next_action: detail.next_action ?? detail.wacrm?.next_action,
  }

  const keeper = {
    ...(detail.keeper || {}),
    keeper_gmv: detail.keeper_gmv ?? detail.keeper?.keeper_gmv,
    keeper_gmv30: detail.keeper_gmv30 ?? detail.keeper?.keeper_gmv30,
    keeper_orders: detail.keeper_orders ?? detail.keeper?.keeper_orders,
  }

  return {
    ...detail,
    joinbrands,
    wacrm,
    keeper,
  }
}

function getLastTs(creator) {
  if (!creator) return 0
  const msgs = creator.messages || creator._full?.messages || []
  const lastMsg = msgs[msgs.length - 1]
  const ts = lastMsg?.timestamp || creator.updated_at || creator.last_active || 0
  return new Date(ts || 0).getTime()
}
