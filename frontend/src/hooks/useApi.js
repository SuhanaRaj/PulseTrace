import { useCallback, useEffect, useRef, useState } from 'react'
import { startLoading } from './fetchState'

// Runs `fetcher` on mount and whenever `deps` change; exposes { data, error, loading, reload }.
// Reloading keeps the previous data on screen; changing `deps` (e.g. the selected project) clears it.
export function useApi(fetcher, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const [nonce, setNonce] = useState(0)
  const latest = useRef(fetcher)
  latest.current = fetcher
  const lastKey = useRef(null)
  useEffect(() => {
    let cancelled = false
    const key = JSON.stringify(deps)
    const keyChanged = lastKey.current !== null && lastKey.current !== key
    lastKey.current = key
    setState(s => startLoading(s, keyChanged))
    latest.current().then(
      data => { if (!cancelled) setState({ data, error: null, loading: false }) },
      error => { if (!cancelled) setState({ data: null, error, loading: false }) },
    )
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])
  const reload = useCallback(() => setNonce(n => n + 1), [])
  return { ...state, reload }
}
