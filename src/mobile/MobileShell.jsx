import React from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
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
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Navigate to="/m" replace />} />
        <Route path="/m" element={<MobileListScreen />} />
        <Route path="/m/chat/:id" element={<MobileChatScreen />} />
        <Route path="/m/chat/:id/detail" element={<MobileDetailScreen />} />
        <Route path="*" element={<Navigate to="/m" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
