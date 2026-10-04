# PulseTrace

PulseTrace is a frontend-only prototype for real-time distributed tracing and developer observability. It provides a responsive dark dashboard for services, request traces, errors, performance, and topology.

## Start

```bash
npm install
npm run dev
```

Use the URL Vite prints in the terminal. Build a production bundle with `npm run build`.

## Highlights

- React Router routes for overview, trace explorer/detail waterfall, service inventory, interactive service map, errors, performance, and settings.
- Realistic shared mock telemetry under `src/data/mockData.js`.
- React Flow topology with health-aware nodes, animated edges, mini-map, zoom/pan and selection drawer.
- Recharts visualizations, table filtering/sorting, drawers, live simulation with pause/resume, and responsive navigation.

## Future integration

`src/services/api.js` is the single integration boundary. Point `VITE_API_URL` to an Express/REST gateway and replace its mock delay functions with Axios calls. A WebSocket subscription can update the live state held by `useLiveData`; OpenTelemetry trace payloads should map into the `traces`, `spanData`, and `services` shapes used here.

## Structure

`src/components` holds reusable layout/UI; `src/pages` holds routes; `src/data` has mock models; `src/hooks` has live behavior; and `src/services/api.js` contains API placeholders.
