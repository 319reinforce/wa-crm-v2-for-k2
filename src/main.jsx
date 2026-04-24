import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import AppAuthGate from './components/AppAuthGate'
import { ToastProvider } from './components/Toast'
import './index.css'

try {
  if (localStorage.getItem('uiVersion')) {
    localStorage.removeItem('uiVersion')
  }
} catch (_) {}

const { pathname, search, hash } = window.location
if (pathname.startsWith('/m')) {
  const legacyHashMatch = pathname.match(/^\/m\/chat\/([^/]+)/)
  const selected = legacyHashMatch ? legacyHashMatch[1] : ''
  const params = new URLSearchParams(search)
  if (selected) params.set('creator', selected)
  const nextSearch = params.toString()
  const nextUrl = `/${nextSearch ? `?${nextSearch}` : ''}${hash || ''}`
  window.history.replaceState(null, '', nextUrl)
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <AppAuthGate>
        <App />
      </AppAuthGate>
    </ToastProvider>
  </React.StrictMode>
)
