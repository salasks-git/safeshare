import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
// Note: JS utility modules (api, ws, i18n, qr, compress) are now proper ES
// modules imported directly by each component that needs them — no globals.

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
