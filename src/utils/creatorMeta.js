import WA from './waTheme'

const TOPIC_STALE_MS = 48 * 3600 * 1000

function getCreatorMessages(creator) {
  return Array.isArray(creator?._full?.messages) ? creator._full.messages : []
}

function normalizeChatTimestamp(value) {
  if (value == null || value === '') return 0
  if (typeof value === 'number') return value > 1e12 ? value : value * 1000
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const n = Number(value)
    return n > 1e12 ? n : n * 1000
  }
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function getCreatorReplyState(creator) {
  const messages = getCreatorMessages(creator)
  if (messages.length > 0) {
    let lastUserTs = 0
    let lastMeTs = 0
    for (const msg of messages) {
      const ts = normalizeChatTimestamp(msg?.timestamp)
      if (!ts) continue
      if (msg?.role === 'user') lastUserTs = Math.max(lastUserTs, ts)
      if (msg?.role === 'me') lastMeTs = Math.max(lastMeTs, ts)
    }
    if (!lastUserTs) return { awaitingReply: false, lastUserTs, lastMeTs, stale: false }
    const stale = (Date.now() - lastUserTs) > TOPIC_STALE_MS
    return {
      awaitingReply: lastMeTs < lastUserTs && !stale,
      lastUserTs,
      lastMeTs,
      stale,
    }
  }

  const lastActiveTs = normalizeChatTimestamp(creator?.last_active)
  const stale = lastActiveTs > 0 && (Date.now() - lastActiveTs) > TOPIC_STALE_MS
  return {
    awaitingReply: !creator?.ev_replied && !stale,
    lastUserTs: 0,
    lastMeTs: 0,
    stale,
  }
}

function hasFlag(...values) {
  return values.some(value => value === true || value === 1 || value === '1')
}

function getSnapshotFlags(creator) {
  return creator?._full?.event_snapshot?.compat_ev_flags || creator?.event_snapshot?.compat_ev_flags || {}
}

function getEventFlagValue(creator, key) {
  const flags = getSnapshotFlags(creator)
  if (Object.prototype.hasOwnProperty.call(flags, key)) return hasFlag(flags[key])
  return null
}

function hasEventFlag(creator, key, ...fallbackValues) {
  const snapshotValue = getEventFlagValue(creator, key)
  if (snapshotValue !== null) return snapshotValue
  return hasFlag(...fallbackValues)
}

function getCreatorTrialPhaseMeta(creator) {
  const full = creator?._full || creator || {}
  const wacrm = full.wacrm || {}
  const joinbrands = full.joinbrands || {}
  const lifecycle = creator?.lifecycle || full.lifecycle || null
  const flags = lifecycle?.flags || {}
  const betaStatus = String(wacrm.beta_status || flags.beta_status || creator?.beta_status || '').trim()

  const trialActive = hasEventFlag(creator, 'ev_trial_active', joinbrands.ev_trial_active, full.ev_trial_active, creator?.ev_trial_active)
  const trialCompleted = hasEventFlag(creator, 'ev_trial_7day', joinbrands.ev_trial_7day, full.ev_trial_7day, creator?.ev_trial_7day, flags.trial_completed)
    || betaStatus === 'completed'
  const monthlyJoined = hasEventFlag(creator, 'ev_monthly_joined', joinbrands.ev_monthly_joined, full.ev_monthly_joined, creator?.ev_monthly_joined)
  const monthlyStarted = hasEventFlag(creator, 'ev_monthly_started', joinbrands.ev_monthly_started, full.ev_monthly_started, creator?.ev_monthly_started)
  const monthlyInvited = hasEventFlag(creator, 'ev_monthly_invited', joinbrands.ev_monthly_invited, full.ev_monthly_invited, creator?.ev_monthly_invited)

  if (monthlyJoined) {
    return { key: 'monthly_joined', label: '月卡加入', color: '#008069', bg: 'rgba(0,168,132,0.12)' }
  }
  if (monthlyStarted || monthlyInvited) {
    return { key: 'monthly_trial', label: '月度试用', color: '#7c3aed', bg: 'rgba(124,58,237,0.12)' }
  }
  if (trialCompleted) {
    return { key: 'trial_completed', label: '首周完成', color: '#0f766e', bg: 'rgba(15,118,110,0.12)' }
  }
  if (trialActive) {
    return { key: 'trial_active', label: '首周试用', color: '#2563eb', bg: 'rgba(37,99,235,0.12)' }
  }
  return null
}

function getCreatorSignalBadges(creator) {
  const full = creator?._full || creator || {}
  const wacrm = full.wacrm || {}
  const joinbrands = full.joinbrands || {}
  const badges = []

  if (hasEventFlag(creator, 'ev_agency_bound', wacrm.agency_bound, joinbrands.ev_agency_bound, full.ev_agency_bound, creator?.agency_bound)) {
    badges.push({ key: 'agency_bound', label: 'Agency', color: '#008069', bg: 'rgba(0,168,132,0.12)' })
  } else if (getCreatorTrialPhaseMeta(creator)?.key?.startsWith('monthly')) {
    badges.push({ key: 'agency_next', label: '待绑 Agency', color: '#0f766e', bg: 'rgba(15,118,110,0.10)' })
  }

  if (hasEventFlag(creator, 'ev_gmv_10k', joinbrands.ev_gmv_10k, full.ev_gmv_10k, creator?.ev_gmv_10k)) {
    badges.push({ key: 'gmv_10k', label: 'GMV 10K', color: '#dc2626', bg: 'rgba(220,38,38,0.12)' })
  } else if (hasEventFlag(creator, 'ev_gmv_5k', joinbrands.ev_gmv_5k, full.ev_gmv_5k, creator?.ev_gmv_5k)) {
    badges.push({ key: 'gmv_5k', label: 'GMV 5K', color: '#ea580c', bg: 'rgba(234,88,12,0.12)' })
  } else if (hasEventFlag(creator, 'ev_gmv_2k', joinbrands.ev_gmv_2k, full.ev_gmv_2k, creator?.ev_gmv_2k)) {
    badges.push({ key: 'gmv_2k', label: 'GMV 2K', color: '#ea580c', bg: 'rgba(234,88,12,0.12)' })
  } else if (hasEventFlag(creator, 'ev_gmv_1k', joinbrands.ev_gmv_1k, full.ev_gmv_1k, creator?.ev_gmv_1k)) {
    badges.push({ key: 'gmv_1k', label: 'GMV 1K', color: '#d97706', bg: 'rgba(217,119,6,0.12)' })
  }

  if (hasEventFlag(creator, 'ev_churned', joinbrands.ev_churned, full.ev_churned, creator?.ev_churned)) {
    badges.push({ key: 'churned', label: '已流失', color: '#dc2626', bg: 'rgba(220,38,38,0.12)' })
  }

  return badges
}

function getCreatorStatusMeta(creator) {
  const full = creator?._full || creator || {}
  const wacrm = full.wacrm || {}
  const joinbrands = full.joinbrands || {}
  const urgencyLevel = Number(wacrm.urgency_level || 0)
  const churned = hasEventFlag(creator, 'ev_churned', joinbrands.ev_churned, full.ev_churned, creator?.ev_churned)
  const agencyBound = hasEventFlag(creator, 'ev_agency_bound', wacrm.agency_bound, joinbrands.ev_agency_bound, full.ev_agency_bound, creator?.agency_bound)
  const isUrgent = wacrm.priority === 'urgent' || urgencyLevel >= 8 || churned
  const replyState = getCreatorReplyState(creator)
  const recentMessagesText = getCreatorMessages(creator).slice(-12).map(m => m?.text || '').join(' ').toLowerCase()
  const isAgencyProspect = !isUrgent && !agencyBound && (
    !!wacrm.agency_bound_at ||
    !!wacrm.agency_deadline ||
    /\b(agency|mcn|contract|sign|signed|binding|bound)\b/.test(recentMessagesText) ||
    /(绑定|签约|机构)/.test(recentMessagesText)
  )

  if (isUrgent && replyState.awaitingReply) {
    return {
      key: 'urgent',
      label: '紧急跟进',
      bg: 'rgba(251,146,60,0.12)',
      hoverBg: 'rgba(251,146,60,0.18)',
      accent: '#fb923c',
    }
  }

  if (isAgencyProspect) {
    return {
      key: 'agency',
      label: 'Agency 转化中',
      bg: 'rgba(16,185,129,0.10)',
      hoverBg: 'rgba(16,185,129,0.16)',
      accent: '#10b981',
    }
  }

  return {
    key: 'default',
    label: '',
    bg: 'transparent',
    hoverBg: WA.hover,
    accent: 'transparent',
  }
}

export {
  getCreatorMessages,
  getCreatorReplyState,
  getCreatorSignalBadges,
  getCreatorStatusMeta,
  getCreatorTrialPhaseMeta,
  normalizeChatTimestamp,
}
