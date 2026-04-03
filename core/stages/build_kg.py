"""Stage 4: build_kg — construct knowledge graph in Neo4j.

Extracts entities (metrics, dimensions, tables) from enriched schema,
infers causal relationships via LLM, and stores everything in Neo4j.
"""
from __future__ import annotations

import json
import os
import logging

from dotenv import load_dotenv

from core.stage import StageBase, StageRegistry, StageResult
from knowledge.workspace import Workspace

load_dotenv()
logger = logging.getLogger(__name__)

NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "dataagent")

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

_CAUSAL_SYSTEM = """\
你是业务分析和因果推断领域专家。基于数据库的指标体系，推断指标之间的因果关系。
返回严格 JSON 格式，不要 markdown 代码块。"""

_CAUSAL_PROMPT = """\
以下是从数据库中提取的指标（metrics）和维度（dimensions）列表：

指标列表：
{metrics}

维度列表：
{dimensions}

表关联关系：
{relationships}

业务规则：
{rules}

请推断：

1. **因果关系 (causal_edges)**: 当某指标异常时，可能的上游原因指标。每条边包含：
   - from_metric: 原因指标ID
   - to_metric: 结果指标ID
   - label: 因果关系描述（如"产量不足导致库存告急"）
   - strength: 因果强度 (strong/medium/weak)

2. **下钻关系 (drilldown_edges)**: 每个指标可以按哪些维度下钻分析。

3. **业务场景 (scenarios)**: 组织为3-8个业务分析场景，每个场景包含：
   - id: 英文标识
   - title: 中文标题
   - description: 一句话说明
   - entry_metric: 入口指标ID
   - keywords: 触发关键词列表

返回 JSON：
{{
  "causal_edges": [
    {{"from_metric": "...", "to_metric": "...", "label": "...", "strength": "strong|medium|weak"}}
  ],
  "drilldown_edges": [
    {{"metric": "...", "dimension": "...", "label": "可按XX下钻"}}
  ],
  "scenarios": [
    {{"id": "...", "title": "...", "description": "...", "entry_metric": "...", "keywords": [...]}}
  ]
}}"""


@StageRegistry.register
class BuildKGStage(StageBase):
    name = "build_kg"
    display_name = "知识图谱构建"
    description = "从 schema 提取实体，LLM 推断因果关系，存入 Neo4j"
    pipeline_type = "setup"
    order = 4

    def run(self, workspace: Workspace, input_data: dict, config: dict) -> StageResult:
        from core.persistence import load_stage_result

        # Load enriched schema
        enrich_result = load_stage_result(workspace.workspace_dir, "enrich")
        if not enrich_result:
            return StageResult(status="failed", errors=["enrich stage not completed"])

        schema = enrich_result["data"]
        introspect = load_stage_result(workspace.workspace_dir, "introspect")
        inferred_fks = introspect["data"]["inferred_fks"] if introspect else []

        # Step 1: Extract entities from schema
        metrics, dimensions, tables = self._extract_entities(schema)

        # Step 2: LLM infer causal relationships
        llm_result = self._infer_causality(workspace, metrics, dimensions, schema, inferred_fks)

        # Step 3: Write to Neo4j
        node_count, edge_count = self._write_to_neo4j(
            workspace.name, metrics, dimensions, tables, llm_result
        )

        # Step 4: Build knowledge_graph.json for persistence
        kg = {
            "nodes": [*[{**m, "type": "metric"} for m in metrics],
                       *[{**d, "type": "dimension"} for d in dimensions],
                       *[{**t, "type": "table"} for t in tables]],
            "edges": {
                "causal": llm_result.get("causal_edges", []),
                "drilldown": llm_result.get("drilldown_edges", []),
            },
            "scenarios": llm_result.get("scenarios", []),
        }

        # Persist as JSON
        out_path = workspace.workspace_dir / "knowledge_graph.json"
        out_path.write_text(json.dumps(kg, ensure_ascii=False, indent=2), encoding="utf-8")

        return StageResult(
            status="needs_review",
            data=kg,
            artifacts=[str(out_path)],
            message=f"KG 构建完成: {node_count} 节点, {edge_count} 关系, "
                    f"{len(llm_result.get('scenarios', []))} 场景。写入 Neo4j 成功。请审核因果关系。",
        )

    # ------------------------------------------------------------------
    # Entity extraction
    # ------------------------------------------------------------------

    def _extract_entities(self, schema: dict) -> tuple[list, list, list]:
        """Extract metrics, dimensions, tables from enriched schema."""
        metrics = []
        dimensions = []
        tables_list = []

        tables = schema.get("tables", {})
        for tbl_name, tbl_info in tables.items():
            tables_list.append({
                "id": f"tbl_{tbl_name}",
                "name": tbl_name,
                "alias": tbl_info.get("alias", tbl_name),
                "description": tbl_info.get("description", ""),
            })

            fields = tbl_info.get("fields", {})
            for col_name, col_info in fields.items():
                col_type = col_info.get("type", "string")
                alias = col_info.get("alias", col_name)
                desc = col_info.get("description", "")

                if col_type in ("float", "integer") and not col_name.lower().endswith(("_id", "_code", "num")):
                    metrics.append({
                        "id": f"metric_{tbl_name}_{col_name}",
                        "name": col_name,
                        "alias": alias,
                        "table": tbl_name,
                        "description": desc,
                    })
                elif col_type == "string" and col_name.lower().endswith(("_descrptn", "_name", "_code", "_typ")):
                    dimensions.append({
                        "id": f"dim_{tbl_name}_{col_name}",
                        "name": col_name,
                        "alias": alias,
                        "table": tbl_name,
                        "description": desc,
                    })

        return metrics, dimensions, tables_list

    # ------------------------------------------------------------------
    # LLM causal inference
    # ------------------------------------------------------------------

    def _infer_causality(self, workspace: Workspace, metrics: list, dimensions: list,
                          schema: dict, inferred_fks: list) -> dict:
        from langchain_openai import ChatOpenAI
        from langchain_core.messages import SystemMessage, HumanMessage

        wc = workspace.llm_config
        llm = ChatOpenAI(
            base_url=wc.get("base_url") or os.getenv("LLM_BASE_URL") or None,
            api_key=wc.get("api_key") or os.getenv("LLM_API_KEY") or "sk-placeholder",
            model=wc.get("model") or os.getenv("LLM_MODEL") or "gpt-4o",
            temperature=0,
        )

        # Format metrics summary (compact)
        metrics_text = "\n".join(
            f"  {m['id']}: {m['alias']}（{m['table']}.{m['name']}）— {m['description'][:80]}"
            for m in metrics[:50]  # cap to avoid token overflow
        )
        dims_text = "\n".join(
            f"  {d['id']}: {d['alias']}（{d['table']}.{d['name']}）"
            for d in dimensions[:30]
        )

        # Relationships and rules
        rels = schema.get("table_relationships", [])
        rels_text = "\n".join(
            f"  {r.get('name', '')}: {r.get('left', '')} ↔ {r.get('right', '')} ON {r.get('on', '')}"
            for r in (rels if isinstance(rels, list) else [])
        )

        rules = schema.get("business_rules", {})
        rules_text = "\n".join(
            f"  {name}: {(r.get('rule', r) if isinstance(r, dict) else r)}"
            for name, r in (rules.items() if isinstance(rules, dict) else [])
        )

        prompt = _CAUSAL_PROMPT.format(
            metrics=metrics_text or "(none)",
            dimensions=dims_text or "(none)",
            relationships=rels_text or "(none)",
            rules=rules_text or "(none)",
        )

        response = llm.invoke([SystemMessage(content=_CAUSAL_SYSTEM), HumanMessage(content=prompt)])
        return self._parse_json(response.content)

    # ------------------------------------------------------------------
    # Neo4j persistence
    # ------------------------------------------------------------------

    def _write_to_neo4j(self, workspace_name: str, metrics: list, dimensions: list,
                         tables: list, llm_result: dict) -> tuple[int, int]:
        """Write all nodes and edges to Neo4j under a workspace namespace."""
        from neo4j import GraphDatabase

        driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
        node_count = 0
        edge_count = 0

        with driver.session() as session:
            # Clean previous data for this workspace
            session.run("MATCH (n {workspace: $ws}) DETACH DELETE n", ws=workspace_name)

            # Create table nodes
            for t in tables:
                session.run(
                    "CREATE (n:Table {id: $id, name: $name, alias: $alias, "
                    "description: $desc, workspace: $ws})",
                    id=t["id"], name=t["name"], alias=t["alias"],
                    desc=t["description"], ws=workspace_name,
                )
                node_count += 1

            # Create metric nodes
            for m in metrics:
                session.run(
                    "CREATE (n:Metric {id: $id, name: $name, alias: $alias, "
                    "table_name: $table, description: $desc, workspace: $ws})",
                    id=m["id"], name=m["name"], alias=m["alias"],
                    table=m["table"], desc=m["description"], ws=workspace_name,
                )
                node_count += 1

            # Create dimension nodes
            for d in dimensions:
                session.run(
                    "CREATE (n:Dimension {id: $id, name: $name, alias: $alias, "
                    "table_name: $table, description: $desc, workspace: $ws})",
                    id=d["id"], name=d["name"], alias=d["alias"],
                    table=d["table"], desc=d["description"], ws=workspace_name,
                )
                node_count += 1

            # Metric → Table belongs_to edges
            for m in metrics:
                session.run(
                    "MATCH (m:Metric {id: $mid, workspace: $ws}), "
                    "(t:Table {name: $tbl, workspace: $ws}) "
                    "CREATE (m)-[:BELONGS_TO]->(t)",
                    mid=m["id"], tbl=m["table"], ws=workspace_name,
                )
                edge_count += 1

            # Dimension → Table belongs_to edges
            for d in dimensions:
                session.run(
                    "MATCH (d:Dimension {id: $did, workspace: $ws}), "
                    "(t:Table {name: $tbl, workspace: $ws}) "
                    "CREATE (d)-[:BELONGS_TO]->(t)",
                    did=d["id"], tbl=d["table"], ws=workspace_name,
                )
                edge_count += 1

            # Causal edges
            for edge in llm_result.get("causal_edges", []):
                result = session.run(
                    "MATCH (a {id: $from_id, workspace: $ws}), "
                    "(b {id: $to_id, workspace: $ws}) "
                    "CREATE (a)-[:CAUSES {label: $label, strength: $strength}]->(b)",
                    from_id=edge["from_metric"], to_id=edge["to_metric"],
                    label=edge.get("label", ""), strength=edge.get("strength", "medium"),
                    ws=workspace_name,
                )
                edge_count += 1

            # Drilldown edges
            for edge in llm_result.get("drilldown_edges", []):
                session.run(
                    "MATCH (m {id: $mid, workspace: $ws}), "
                    "(d {id: $did, workspace: $ws}) "
                    "CREATE (m)-[:DRILLDOWN {label: $label}]->(d)",
                    mid=edge["metric"], did=edge["dimension"],
                    label=edge.get("label", ""),
                    ws=workspace_name,
                )
                edge_count += 1

            # Scenario nodes
            for sc in llm_result.get("scenarios", []):
                session.run(
                    "CREATE (s:Scenario {id: $id, title: $title, description: $desc, "
                    "entry_metric: $entry, keywords: $kw, workspace: $ws})",
                    id=sc["id"], title=sc["title"], desc=sc.get("description", ""),
                    entry=sc.get("entry_metric", ""), kw=json.dumps(sc.get("keywords", [])),
                    ws=workspace_name,
                )
                node_count += 1

                # Link scenario to entry metric
                if sc.get("entry_metric"):
                    session.run(
                        "MATCH (s:Scenario {id: $sid, workspace: $ws}), "
                        "(m {id: $mid, workspace: $ws}) "
                        "CREATE (s)-[:ENTRY_POINT]->(m)",
                        sid=sc["id"], mid=sc["entry_metric"], ws=workspace_name,
                    )
                    edge_count += 1

        driver.close()
        return node_count, edge_count

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _parse_json(self, raw: str) -> dict:
        import re
        raw = raw.strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
        raw = re.sub(r"\s*```$", "", raw)
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            start, end = raw.find("{"), raw.rfind("}")
            if start != -1 and end > start:
                return json.loads(raw[start:end + 1])
            return {"causal_edges": [], "drilldown_edges": [], "scenarios": []}
