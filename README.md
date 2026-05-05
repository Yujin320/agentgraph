# AgentGraph: Knowledge-Graph Augmented Agent Framework for Multi-Step Association Analysis

<!-- <div align="center">

[![Paper](https://img.shields.io/badge/Paper-Internetware%202026-blue)](https://anonymous.4open.science/r/agentgraph-88E8)
[![License: MIT](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.11+-yellow)](https://python.org)
[![LangGraph](https://img.shields.io/badge/LangGraph-0.2-orange)](https://github.com/langchain-ai/langgraph)

**[Internetware 2026]** Official implementation of *"AgentGraph: Knowledge-Graph Augmented Agent Framework for Multi-Step Association Analysis"*

</div> -->

---

## Overview

Complex association analysis — microservice root-cause analysis, supply-chain causal attribution, AML fund-flow auditing — requires multi-step, context-sensitive reasoning over graph-structured operational data guided by domain knowledge. Current tools (Neo4j Browser, NeoDash, Grafana) are built around a **single-query paradigm** that fragments investigations and discards analytical context between sessions.

**AgentGraph** elevates the *analysis chain* into a first-class system artifact enriched with domain knowledge, comprising four layers:

| Layer | Responsibility | Key Technology |
|---|---|---|
| **Unified Interaction** | NL entry, real-time chain visualisation, HITL gate, report archival | React 19, ECharts, SSE |
| **Agent Orchestration** | Planner–Executor–Evaluator coordination via shared `AgentState` | LangGraph StateGraph |
| **Analysis Chain Modeling** | DAG-based investigation workflows, step typing, chain templates | Custom DAG engine |
| **Domain Knowledge** | Schema ontology, Analysis Patterns (top-k retrieval), GraphRAG | Neo4j, ChromaDB, Vanna |

### Key Results

| RQ | Result |
|---|---|
| RQ1 — NL-to-Query (CypherBench, N=500) | Up to **+30.4 pp EA** over vanilla LLM; **+42 pp** on domain queries |
| RQ2 — End-to-End (100 RCA fault cases) | **81% Top-1** accuracy; **82% reduction** in attribution time vs. manual |
| RQ3 — User Study (N=14) | **SUS = 82.4** (Good); **71%** task time reduction; **55%** fewer interactions |
| RQ4 — Ablation | Each of 5 architectural components contributes independently |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│              Layer A: Unified Interaction Layer                 │
│     NL Input │ Analysis Chain DAG View │ HITL Gate │ Report     │
└──────────────────────────┬──────────────────────────────────────┘
                           │ NL goal q
┌──────────────────────────▼──────────────────────────────────────┐
│              Layer B: Agent Orchestration Layer                  │
│                                                                  │
│  ┌──────────┐  Chain C  ┌──────────┐  Step result  ┌──────────┐  │
│  │ Planner  │──────────▶│ Executor │─────────────▶ │Evaluator │  │
│  │          │           │          │  continue ───▶│          │  │
│  │·Classify │           │·NL→Query │  branch   ──▶ │·4-dim    │  │
│  │ intent   │◀─re-plan──│·Self-heal│  backtrack ──▶│ assess   │  │
│  │·Retrieve │           │·Tool call│  h.intervene  │·5-dec.   │  │
│  │ patterns │           └──────────┘  terminate ───▶          │  │
│  └──────────┘                                      └──────────┘  │
└──────────────────────────┬──────────────────────────────────────┘
        Context Injection ↑│
┌────────────────────────────────────────────────────────────────────┐
│  Layer C: Analysis Chain Modeling    Layer D: Domain Knowledge     │
│                                                                    │
│  [CypherQuery] [GraphAlgorithm]      Entity-Relation  (Neo4j)      │
│  [MetricCheck] [PatternMatch]        Ontology Layer                │
│  [Aggregate]                         Analysis Pattern Library      │
└────────────────────────────────────────────────────────────────────┘
```

---

## Core Concepts

### Analysis Chain

An Analysis Chain is $C = (S, T, s_0, S_f)$ where $S$ is a set of typed `AnalysisStep` nodes, $T$ is the set of conditional transitions forming a DAG, $s_0$ is the initial step, and $S_f$ is the set of terminal steps (`core/reasoning/state.py`).

**Five step types** (`StepType` enum):

| Type | Description |
|---|---|
| `CypherQuery` | Schema-aware NL-to-SQL generation with self-healing |
| `GraphAlgorithm` | PageRank, Louvain, k-hop expansion via Neo4j GDS |
| `MetricCheck` | External observability API calls (Prometheus, etc.) |
| `PatternMatch` | Parameterised Cypher template instantiation |
| `Aggregate` | Synchronise and summarise parallel branch results |

### Analysis Patterns

Stored in `workspaces/<name>/causal_graph.json` under `analysis_patterns`. Each pattern: $p = (\text{name}, \text{trigger}, \text{steps}, \text{domain})$. The Planner retrieves top-k=3 matching patterns per query. The supply-chain workspace ships with 5 pre-registered patterns covering procurement attribution, sales achievement, production quality, delivery delay, and cost overrun.

### Planner–Executor–Evaluator

| Agent | File | Role |
|---|---|---|
| Planner | `core/reasoning/planner.py` | Classifies intent → retrieves patterns → instantiates chain DAG |
| Executor | `core/reasoning/executor.py` | Generates query, runs self-healing loop (k=3), records `repair_log` |
| Evaluator | `core/reasoning/evaluator.py` | 4-dim assessment → 5-decision routing (continue/branch/backtrack/human_intervene/terminate) |

**Evaluator decisions:**

| Decision | Trigger | Next |
|---|---|---|
| `continue` | Useful but non-conclusive | executor (next step) |
| `branch` | New analysis direction found | planner (re-invoke, extend DAG) |
| `backtrack` | Dead end; pop `branch_stack` | executor (prior checkpoint) |
| `human_intervene` | Low confidence / self-healing exhausted | conclude (partial report) |
| `terminate` | Sufficiency criterion satisfied | conclude |

---

## Repository Structure

```
agentgraph/
├── core/
│   ├── reasoning/
│   │   ├── planner.py        # Planner Agent
│   │   ├── executor.py       # Executor Agent (self-healing, repair_log)
│   │   ├── evaluator.py      # Evaluator Agent (4-dim, 5-decision)
│   │   ├── graph.py          # LangGraph StateGraph (P→E→Ev DAG)
│   │   ├── state.py          # AgentState, AnalysisStep, StepType, RepairRecord
│   │   └── nodes.py          # conclude_node + backward-compat re-exports
│   └── stages/               # 5-stage Setup Pipeline
│       ├── connect.py        #   Stage 1: DB connection
│       ├── introspect.py     #   Stage 2: Schema discovery
│       ├── enrich.py         #   Stage 3: LLM enrichment (human checkpoint)
│       ├── build_kg.py       #   Stage 4: Neo4j KG construction (human checkpoint)
│       └── train_sql.py      #   Stage 5: Few-shot SQL indexing
├── knowledge/
│   ├── workspace.py          # Workspace management
│   ├── vanna_store.py        # ChromaDB few-shot retrieval
│   └── schema_builder.py     # Schema enrichment utilities
├── backend/
│   ├── main.py               # FastAPI app
│   └── routers/              # chat, agent (SSE), pipeline, graph, workspace, ...
├── frontend/src/             # React 19, Ant Design 5, ECharts
├── workspaces/
│   └── supply-chain/         # Pre-built demo workspace (Scenario B)
│       ├── causal_graph.json # 6-layer causal graph + analysis_patterns library
│       ├── few_shots.json    # 21 hand-crafted SQL examples
│       └── few_shots_auto.json # 44 auto-generated examples
├── experiments/              # Evaluation scripts (released upon acceptance)
│   ├── rq1/                  # NL-to-Query accuracy (C1–C5 ablation)
│   ├── rq2/                  # End-to-end effectiveness
│   └── rq4/                  # Component ablation
└── docs/
    ├── TECHNICAL_REPORT.md
    └── SYSTEM_DESIGN.md
```

---

## Installation

### Prerequisites

- Python 3.11+, Node.js 18+
- Neo4j 5+ (optional; required for GraphAlgorithm steps and Scenario A)
- OpenAI-compatible API key (GPT-4o, DeepSeek-V3, or Qwen-2.5)

### Docker (recommended)

```bash
git clone https://anonymous.4open.science/r/agentgraph-88E8
cd agentgraph
cp .env.example .env    # set LLM_API_KEY, LLM_BASE_URL, LLM_MODEL
docker-compose up -d    # starts Neo4j + FastAPI backend
# open http://localhost:8001
```

### Local Development

```bash
# Backend
pip install -e .
cp .env.example .env
uvicorn backend.main:app --host 0.0.0.0 --port 8001 --reload

# Frontend (separate terminal)
cd frontend && npm install && npm run dev   # http://localhost:5173
```

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `LLM_API_KEY` | OpenAI-compatible API key | required |
| `LLM_BASE_URL` | API base URL (override for DeepSeek/Qwen) | OpenAI |
| `LLM_MODEL` | Backbone model name | `gpt-4o` |
| `NEO4J_URI` | Neo4j connection URI | `bolt://localhost:7687` |
| `NEO4J_USER` / `NEO4J_PASSWORD` | Neo4j credentials | `neo4j` / `dataagent` |

---

## Supply-Chain Demo (Scenario B)

The `workspaces/supply-chain/` workspace implements the supply-chain causal attribution scenario from the paper: a 6-layer causal graph (supply → production → inventory → sales → customer → cost), 65 few-shot SQL examples, and 8 attribution scenarios. No setup required — the workspace is pre-built.

> **Note on Data Confidentiality:** Due to data confidentiality requirements, we are unable to provide the detailed few-shot SQL examples or grant access to the underlying data systems used in this scenario. As a result, only the pre-built demonstration query shown below can be reproduced; testing with other questions or custom attribution scenarios is not supported in this public release.

```bash
# Start the server, then:
curl -X POST http://localhost:8001/api/workspaces/supply-chain/chat/agent \
  -H "Content-Type: application/json" \
  -d '{"message": "为什么本月外调品比例增加了？"}' --no-buffer
```

Expected output: a 3-step Analysis Chain (MetricCheck → CypherQuery → Aggregate) that traces the attribution to inventory shortage, completing in ~8 minutes including the HITL SQL review gate.

---

## Extending to a New Domain

All domain logic is isolated in the Domain Knowledge Layer. The Planner–Executor–Evaluator orchestration logic is unchanged:

1. **Connect** your data source — Stage 1 (Connect) + Stage 2 (Introspect)
2. **Enrich** schema semantics — Stage 3 (LLM-assisted, human review checkpoint)
3. **Build Knowledge Graph** — Stage 4 (Neo4j ontology + causal edges, human checkpoint)
4. **Register Analysis Patterns** — add entries to `causal_graph.json` under `analysis_patterns`
5. **Index few-shot examples** — Stage 5 (Train SQL, auto-generates 44+ examples)

Typical onboarding time: **< 5 minutes** (see paper Table 5 for actual measured times).

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/workspaces` | Create workspace |
| `GET` | `/api/workspaces/{ws}/pipeline` | Get setup pipeline state |
| `POST` | `/api/workspaces/{ws}/pipeline/run/{stage}` | Run a pipeline stage |
| `POST` | `/api/workspaces/{ws}/chat/agent` | **Agentic reasoning** (SSE streaming) |
| `POST` | `/api/workspaces/{ws}/chat/resume` | Resume after HITL intervention |
| `GET` | `/api/workspaces/{ws}/graph/echarts` | Knowledge graph DAG data |
| `GET` | `/api/workspaces/{ws}/scenarios` | List Analysis Patterns / Chain Templates |
| `POST` | `/api/explorer/{ws}/query` | Execute read-only SQL |

Full OpenAPI docs: `http://localhost:8001/docs`

---

## Tech Stack

| Component | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Ant Design 5, ECharts |
| Backend | FastAPI, Python 3.11+, uvicorn |
| Agent Orchestration | LangGraph 0.2, LangChain 0.3 |
| NL-to-Query | Vanna 0.7 (ChromaDB) + schema-aware prompting + self-healing |
| Graph Database | Neo4j 5 + GDS library |
| Relational DB | SQLAlchemy 2 (SQLite / PostgreSQL / MySQL) |
| Deployment | Docker, docker-compose |

---

<!-- ## Citation

```bibtex
@inproceedings{agentgraph2026,
  title     = {AgentGraph: Knowledge-Graph Augmented Agent Framework
               for Multi-Step Association Analysis},
  author    = {Anonymous},
  booktitle = {Proceedings of the 18th Asia-Pacific Symposium on Internetware},
  year      = {2026},
  note      = {Under review. \url{https://anonymous.4open.science/r/agentgraph-88E8}}
}
``` -->

---

## License

[MIT License](LICENSE)
