import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import MobileShell from './mobile/MobileShell'
import './index.css'

const params = new URLSearchParams(window.location.search)
const uiQuery = params.get('ui')
const stored = localStorage.getItem('uiVersion')

if (uiQuery === 'v2') localStorage.setItem('uiVersion', 'v2')
if (uiQuery === 'legacy') localStorage.setItem('uiVersion', 'legacy')

const preferMobile = uiQuery === 'v2' || stored === 'v2'
const forceLegacy = uiQuery === 'legacy' || stored === 'legacy'

const RootApp = (!forceLegacy && preferMobile) ? MobileShell : App

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>
)
