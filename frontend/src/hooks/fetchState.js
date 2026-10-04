// Pure state transition used by useApi when a request starts.
// Same request key (reload / retry): keep the previous data on screen while refreshing.
// Different key (e.g. another project or trace id): drop it so stale data from the old key is never shown.
export const startLoading = (prev, keyChanged) => (keyChanged ? { data: null, error: null, loading: true } : { ...prev, error: null, loading: true })
