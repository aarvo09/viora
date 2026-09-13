import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, auth } from '../api/client'

export function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('caseworker@viora.local')
  const [password, setPassword] = useState('viora1234')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!auth.token()) {
      api.login('caseworker@viora.local', 'viora1234')
        .then((res) => {
          auth.save(res)
          navigate('/', { replace: true })
        })
        .catch(() => {})
    }
  }, [navigate])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await api.login(email.trim(), password)
      auth.save(res)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--s6)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div className="stack stack-2" style={{ marginBottom: 'var(--s8)', textAlign: 'center' }}>
          <span
            style={{
              fontSize: 'var(--fs-xl)',
              fontWeight: 700,
              letterSpacing: '0.16em',
              color: 'var(--primary)',
            }}
          >
            VIORA
          </span>
          <span className="muted small">Case management</span>
        </div>

        <form className="card card-pad stack stack-4" onSubmit={submit}>
          <div className="stack stack-2">
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="stack stack-2">
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
            />
          </div>

          {error && (
            <p role="alert" className="small" style={{ color: 'var(--risk-critical)' }}>
              {error}
            </p>
          )}

          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

      </div>
    </div>
  )
}
