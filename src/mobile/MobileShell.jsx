import React from 'react'
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import MobileListScreen from './MobileListScreen'
import MobileChatScreen from './MobileChatScreen'
import MobileDetailScreen from './MobileDetailScreen'

function ScrollToTop() {
  const { pathname } = useLocation()
  React.useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

export default function MobileShell() {
  return (
    <HashRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Navigate to="/m" replace />} />
        <Route path="/m" element={<MobileListScreen />} />
        <Route path="/m/chat/:id" element={<MobileChatScreen />} />
        <Route path="/m/chat/:id/detail" element={<MobileDetailScreen />} />
        <Route path="*" element={<Navigate to="/m" replace />} />
      </Routes>
    </HashRouter>
  )
}
