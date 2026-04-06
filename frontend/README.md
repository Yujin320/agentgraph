# DataAgent v2 Frontend

React 19 + TypeScript SPA for the DataAgent intelligent Q&A platform.

## Tech Stack

- **React 19** with React Router v7
- **Ant Design 5** component library
- **ECharts 6** for data visualization and knowledge graph rendering
- **Vite 8** build tool
- **TypeScript 5.9**

## Development

```bash
npm install
npm run dev       # Start dev server (HMR on :5173)
npm run build     # Production build → dist/
npm run lint      # ESLint check
```

The production build is served by the FastAPI backend as a static mount at `/`.

## Pages

| Page | Route | Description |
|------|-------|-------------|
| Home | `/` | Workspace list and creation |
| Attribution Explorer | `/w/:ws` | Main chat interface with causal reasoning |
| Causal Graph | `/w/:ws/graph` | Neo4j knowledge graph visualization |
| Data Browser | `/w/:ws/data` | Table explorer with SQL query |
| Pipeline Setup | `/w/:ws/setup` | 5-stage onboarding pipeline |
| Schema Review | `/w/:ws/setup/schema` | Column-level schema editing |
| Data Governance | `/w/:ws/governance` | Table stats and data quality |
| Query Logs | `/w/:ws/logs` | Query history and analytics |
| System Config | `/w/:ws/config` | LLM and system settings |

## Theming

Dual light/dark theme via `ThemeContext`. Theme preference is persisted to `localStorage`.

- CSS variables injected on `<body>` for non-Ant components
- Ant Design `ConfigProvider` for component-level theming
- Typography: Plus Jakarta Sans (body), Instrument Serif (headings), JetBrains Mono (code)

## API Client

`src/api/client.ts` exports:

- `api` -- Axios instance with `/api` base URL and Bearer token injection
- `pipelineApi` -- Typed helpers for pipeline CRUD
- `fetchSSE()` -- Fetch-based SSE client for streaming chat (supports named events)
