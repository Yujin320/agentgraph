# DataAgent v2

> Multi-step causal attribution agent for supply chain analytics, powered by LangGraph + Vanna + Neo4j.

DataAgent v2 is an intelligent Q&A system that performs **multi-step causal reasoning** over structured business data. Given a natural-language question (e.g. "Why did external procurement increase this month?"), the system automatically plans an attribution chain, generates and executes SQL queries, compares results against configurable thresholds, and traces anomalies upstream until a root cause is identified.

## Architecture

```
+---------------------------------------------------------+
|  Application Layer          React 19 / Ant Design / SSE |
+---------------------------------------------------------+
|  Engine Layer       LangGraph Plan-Execute-Reflect Loop  |
+---------------------------------------------------------+
|  Knowledge Layer    causal_graph / schema_dict / few_shots|
+---------------------------------------------------------+
|  Data Layer           SQLAlchemy / SQLite / Neo4j        |
+---------------------------------------------------------+
```

**Four-layer design:**

| Layer | Responsibility | Key Tech |
|-------|---------------|----------|
| Application | Interactive web UI, chart visualization, real-time streaming | React 19, Ant Design 5, ECharts, SSE |
| Engine | Multi-step reasoning orchestration, intent recognition, strategy dispatch | LangGraph StateGraph, LangChain |
| Knowledge | Causal graph, semantic schema dictionary, few-shot SQL examples | Neo4j, ChromaDB, Vanna |
| Data | Multi-database connectivity, SQL execution, workspace isolation | SQLAlchemy 2, SQLite/PostgreSQL/MySQL |

## Key Features

- **Causal Attribution Engine** -- Plan-Execute-Reflect loop that follows causal graph edges to trace anomalies to root causes
- **6 Reasoning Strategies** -- Causal, Statistical, Comparative, Trend, What-If analysis, each as a composable LangGraph sub-graph
- **Human-in-the-Loop** -- SQL approval gate via LangGraph `interrupt_before`, allowing users to review/edit generated queries before execution
- **5-Stage Setup Pipeline** -- Connect, Introspect, Enrich, Build KG, Train SQL -- automated workspace onboarding with review checkpoints
- **Natural Language to SQL** -- RAG-enhanced text-to-SQL with schema context, few-shot examples, and self-correction (up to 3 retries)
- **Knowledge Graph** -- Neo4j-backed causal graph with scenario nodes, KPI metrics, and dimensional drill-down paths
- **Dual Theme UI** -- Light/dark mode with CSS variables and Ant Design ConfigProvider integration
- **Workspace Isolation** -- Each workspace has its own database, knowledge files, and pipeline state

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | React 19, TypeScript, Vite 8, Ant Design 5, ECharts 6 |
| Backend | FastAPI, Python 3.11+, uvicorn |
| Reasoning | LangGraph 0.2, LangChain 0.3, langchain-openai |
| SQL Generation | Vanna 0.7 (ChromaDB vector store) |
| Graph DB | Neo4j 5 |
| Database | SQLAlchemy 2 (SQLite / PostgreSQL / MySQL) |
| Deployment | Docker, docker-compose, Caddy reverse proxy |

## Project Structure

```
dataagent-v2/
  backend/
    main.py                 # FastAPI app entry point
    routers/                # 10 API router modules
      chat.py               #   SSE streaming chat
      agent.py              #   Agentic reasoning endpoints
      pipeline.py           #   Pipeline orchestration
      explorer.py           #   Data exploration
      workspace.py          #   Workspace CRUD
      graph.py              #   Knowledge graph visualization
      scenarios.py          #   Scenario & KPI management
      logs.py               #   Query history & analytics
      system.py             #   Health, LLM config
  core/
    pipeline.py             # PipelineOrchestrator
    stage.py                # StageBase abstract class
    stages/                 # 7 pipeline stage implementations
      connect.py            #   DB connection validation
      introspect.py         #   Schema auto-discovery
      enrich.py             #   LLM semantic enrichment
      build_kg.py           #   Neo4j graph construction
      train_sql.py          #   Few-shot SQL training
      text_to_sql.py        #   NL-to-SQL with RAG
      attribution.py        #   Multi-path causal analysis
    reasoning/              # LangGraph reasoning framework
      graph.py              #   StateGraph composition
      state.py              #   AgentState TypedDict
      nodes.py              #   6 graph nodes
      prompts.py            #   Prompt templates
      strategies/           #   6 composable strategy sub-graphs
    nodes/                  # LangGraph node implementations
  knowledge/
    workspace.py            # Workspace management & persistence
    schema_builder.py       # Schema enrichment utilities
    doc_retriever.py        # Document RAG
    vanna_store.py          # Vanna SQL vector store
  frontend/
    src/
      pages/                # 13 page components
      components/           # Shared UI components
      layouts/              # AppLayout with sidebar navigation
      api/                  # Axios client & SSE helper
      contexts/             # ThemeContext (light/dark)
      styles/               # Theme tokens & global CSS
      hooks/                # useChat custom hook
  workspaces/               # Workspace data (DB, configs, knowledge files)
  docs/                     # Architecture docs & diagrams
```

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 18+
- Neo4j 5+ (optional, for knowledge graph)

### Backend

```bash
# Install dependencies
pip install -e .

# Configure environment
cp .env.example .env
# Edit .env: set OPENAI_API_KEY, NEO4J_URI, etc.

# Start the server
uvicorn backend.main:app --host 0.0.0.0 --port 8001
```

### Frontend

```bash
cd frontend
npm install
npm run build      # Production build (served by FastAPI static mount)
# or
npm run dev        # Development server with HMR
```

### Docker

```bash
docker-compose up -d   # Starts Neo4j + FastAPI backend
```

## API Overview

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/workspaces` | Create a new workspace |
| `GET` | `/api/workspaces/{ws}/pipeline` | Get pipeline state |
| `POST` | `/api/workspaces/{ws}/pipeline/run/{stage}` | Run a pipeline stage |
| `POST` | `/api/workspaces/{ws}/chat` | SSE streaming chat |
| `POST` | `/api/workspaces/{ws}/chat/agent` | Agentic reasoning (SSE) |
| `POST` | `/api/workspaces/{ws}/chat/resume` | Resume after HITL approval |
| `GET` | `/api/explorer/{ws}/tables` | List tables with row counts |
| `POST` | `/api/explorer/{ws}/query` | Execute read-only SQL |
| `GET` | `/api/workspaces/{ws}/graph/echarts` | Knowledge graph DAG data |
| `GET` | `/api/workspaces/{ws}/scenarios` | List attribution scenarios |

## Reasoning Flow

```
User Question
     |
     v
[Intent Recognition] -- classify question type & extract entities
     |
     v
[Strategy Selection] -- pick from: causal / statistical / comparative / trend / what-if
     |
     v
[Plan Generation] -- create step-by-step attribution plan
     |
     v
+---> [SQL Generation] -- generate SQL from plan step + schema context
|         |
|    [HITL Gate] -- user reviews & approves SQL (optional)
|         |
|    [SQL Execution] -- run query, self-correct on error (max 3 retries)
|         |
|    [Reflection] -- compare result against threshold
|         |
|    abnormal? --yes--> continue to next causal node
|         |
+----<----+
     |
     no / max depth / no upstream
     |
     v
[Conclusion] -- generate attribution summary + chart spec
```

## License

Proprietary. Internal use only.
