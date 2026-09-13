import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { auth } from './api/client'
import { Shell } from './components/Shell'
import { Alerts } from './pages/Alerts'
import { Analytics } from './pages/Analytics'
import { CaseView } from './pages/CaseView'
import { Cases } from './pages/Cases'
import { Conversations } from './pages/Conversations'
import { FollowUps } from './pages/FollowUps'
import { Login } from './pages/Login'
import { Reports } from './pages/Reports'
import { Settings } from './pages/Settings'
import { Today } from './pages/Today'
import './styles/tokens.css'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ padding: 32, fontFamily: 'monospace', maxWidth: 900 }}>
        <h1 style={{ fontSize: 18, color: '#ba1a1a', marginBottom: 12 }}>
          VIORA dashboard failed to render
        </h1>
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            background: '#ffdad6',
            border: '1px solid #ba1a1a',
            borderRadius: 8,
            padding: 16,
            fontSize: 13,
            color: '#93000a',
          }}
        >
          {this.state.error.message}
          {'\n\n'}
          {this.state.error.stack}
        </pre>
      </div>
    )
  }
}

function RequireAuth({ children }: { children: ReactNode }) {
  return auth.token() ? <>{children}</> : <Navigate to="/login" replace />
}

const rootEl = document.getElementById('root')
if (!rootEl) {
  document.body.innerHTML =
    '<pre style="padding:32px;font-family:monospace">No #root element in index.html</pre>'
} else {
  createRoot(rootEl).render(
    <StrictMode>
      <ErrorBoundary>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              element={
                <RequireAuth>
                  <Shell />
                </RequireAuth>
              }
            >
              <Route path="/" element={<Today />} />
              <Route path="/cases" element={<Cases />} />
              <Route path="/cases/:id" element={<CaseView />} />
              <Route path="/alerts" element={<Alerts />} />
              <Route path="/conversations" element={<Conversations />} />
              <Route path="/follow-ups" element={<FollowUps />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ErrorBoundary>
    </StrictMode>,
  )
}
