# Evaluation Scripts

Evaluation scripts for the four research questions in the AgentGraph paper will be released upon acceptance.

## RQ1 — NL-to-Query Accuracy (CypherBench)
`rq1/` — C1–C5 ablation across GPT-5-nano, DeepSeek-Coder-V2-Lite, Qwen-2.5-Coder-14B on 500 CypherBench queries.

## RQ2 — End-to-End Effectiveness
`rq2/` — Scenario A (microservice RCA, 100 fault cases) and Scenario B (supply-chain attribution, deployed prototype).

## RQ4 — Ablation Study
`rq4/` — Five ablated variants: AgentGraph-NoDK, -NoChain, -NoEval, -NoHeal, -Single.

## Reproducing Scenario B (Supply-Chain)
The supply-chain demo workspace is available at `workspaces/supply-chain/` and can be run immediately:

```bash
# Start the server
uvicorn backend.main:app --host 0.0.0.0 --port 8001

# Ask an attribution question
curl -X POST http://localhost:8001/api/workspaces/supply-chain/chat/agent \
  -H "Content-Type: application/json" \
  -d '{"message": "为什么本月外调品比例增加了？"}' --no-buffer
```
