/**
 * Buffered telemetry transport for PulseTrace.
 *
 * - Buffers spans/errors in memory.
 * - Flushes on batch-size or interval.
 * - Retries failed deliveries with bounded exponential backoff.
 * - Never lets telemetry failures reject or crash the monitored application.
 */
export function createTransport({
  ingestUrl,
  timeout,
  fetch,
  reportError,
  batchSize = 20,
  flushInterval = 1000,
  maxQueueSize = 5000,
  maxRetries = 2,
  retryDelay = 250,
}) {
  const queue = []
  let timer = null
  let flushing = false
  let closed = false

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const schedule = () => {
    if (closed || timer !== null || !queue.length) return
    timer = setTimeout(() => {
      timer = null
      void flush()
    }, flushInterval)
  }

  const post = async (batch) => {
    let lastError = null

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const controller = new AbortController()
      const timerId = setTimeout(() => controller.abort(), timeout)

      try {
        const response = await fetch(ingestUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(batch),
          signal: controller.signal,
        })

        let body = null
        try { body = await response.json() } catch { /* non-JSON body */ }

        if (response.status >= 200 && response.status < 300) {
          if (body?.data?.rejected?.length) {
            reportError(new Error(
              `PulseTrace rejected ${body.data.rejected.length} telemetry item(s): ${JSON.stringify(body.data.rejected)}`
            ))
          }
          return { ok: true, status: response.status, body }
        }

        lastError = new Error(
          `PulseTrace responded with HTTP ${response.status}` +
          `${body?.message ? `: ${body.message}` : ''}` +
          `${body?.data?.rejected ? ` ${JSON.stringify(body.data.rejected)}` : ''}`
        )
      } catch (error) {
        lastError = controller.signal.aborted
          ? new Error(`PulseTrace did not respond within ${timeout}ms (${ingestUrl})`)
          : error
      } finally {
        clearTimeout(timerId)
      }

      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay * (2 ** attempt)))
      }
    }

    reportError(lastError || new Error('PulseTrace telemetry delivery failed'))
    return { ok: false, status: null, body: null }
  }

  async function flush() {
    if (flushing || !queue.length || closed && !queue.length) return
    flushing = true
    clearTimer()

    try {
      // Take a bounded batch. Anything remaining stays queued for the next flush.
      const batchItems = queue.splice(0, batchSize)
      const batch = {
        spans: batchItems.flatMap(item => item.spans || []),
        errors: batchItems.flatMap(item => item.errors || []),
      }

      if (!batch.spans.length && !batch.errors.length) return

      const result = await post(batch)

      // Requeue on delivery failure, preserving order, unless the transport is being
      // shut down and the caller has explicitly chosen to discard remaining telemetry.
      if (!result.ok) {
        queue.unshift(...batchItems)
        // Avoid an immediate retry loop; schedule() will retry later.
      }
    } finally {
      flushing = false
      if (queue.length) schedule()
    }
  }

  function enqueue(batch) {
    if (closed) return
    const spans = Array.isArray(batch?.spans) ? batch.spans : []
    const errors = Array.isArray(batch?.errors) ? batch.errors : []
    if (!spans.length && !errors.length) return

    // Each enqueue item is a logical telemetry payload. A large logical payload
    // is accepted, but the queue itself remains bounded.
    if (queue.length >= maxQueueSize) {
      queue.shift()
      reportError(new Error(`PulseTrace telemetry queue is full; oldest telemetry was dropped`))
    }

    queue.push({ spans, errors })

    if (queue.length >= batchSize) {
      void flush()
    } else {
      schedule()
    }
  }

  async function shutdown({ discard = false } = {}) {
    closed = true
    clearTimer()

    if (discard) {
      queue.length = 0
      return
    }

    // Drain queued payloads without creating an unbounded shutdown loop.
    while (queue.length && !flushing) {
      await flush()
      // A failed flush requeues the batch. Do not block application shutdown forever.
      if (queue.length) break
    }
  }

  return {
    enqueue,
    send: enqueue, // backward-compatible internal name
    flush,
    shutdown,
    get pending() { return queue.length }
  }
}
