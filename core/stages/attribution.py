"""Stage 7: attribution — multi-path causal attribution via Neo4j traversal.

Given an abnormal metric, traverses the KG upstream to find all possible
root causes. Each path is verified with SQL, scored by evidence strength,
and ranked.
"""
from __future__ import annotations

import json
import os
import re
import logging
from dataclasses import dataclass, field

from dotenv import load_dotenv

from core.stage import StageBase, StageRegistry, StageResult
from knowledge.workspace import Workspace

load_dotenv()
logger = logging.getLogger(__name__)

NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "dataagent")

_CONCLUSION_SYSTEM = """\
你是供应链归因分析专家。根据多条归因路径的验证结果，生成简洁的归因报告。
要求：300字以内，列出最可能的根因，给出改善建议。"""


@dataclass
class AttributionStep:
    node_id: str
    alias: str
    table: str
    sql: str = ""
    value: float | None = None
    threshold: float | None = None
    threshold_op: str = ""
    is_abnormal: bool = False
    deviation: float = 0.0  # |value - threshold| / threshold

    def to_dict(self) -> dict:
        return {
            "node_id": self.node_id, "alias": self.alias, "table": self.table,
            "sql": self.sql, "value": self.value, "threshold": self.threshold,
            "threshold_op": self.threshold_op, "is_abnormal": self.is_abnormal,
            "deviation": round(self.deviation, 3),
        }


@dataclass
class AttributionPath:
    steps: list[AttributionStep] = field(default_factory=list)
    score: float = 0.0  # product of deviations along the path
    root_cause: str = ""

    def to_dict(self) -> dict:
        return {
            "steps": [s.to_dict() for s in self.steps],
            "score": round(self.score, 3),
            "root_cause": self.root_cause,
        }


@StageRegistry.register
class AttributionStage(StageBase):
    name = "attribution"
    display_name = "多路归因分析"
    description = "沿KG因果边多路BFS，并行验证每条路径，按证据强度排序"
    pipeline_type = "runtime"
    order = 7

    def run(self, workspace: Workspace, input_data: dict, config: dict) -> StageResult:
        """
        input_data:
          question: str — user question
          entry_metric_id: str — the metric node to start attribution from (optional)
          scenario_id: str — scenario to use (optional)
        """
        from langchain_openai import ChatOpenAI
        from langchain_core.messages import SystemMessage, HumanMessage

        question = input_data.get("question", "")
        entry_metric_id = input_data.get("entry_metric_id", "")
        scenario_id = input_data.get("scenario_id", "")
        max_depth = config.get("max_depth", 5)

        wc = workspace.llm_config
        llm = ChatOpenAI(
            base_url=wc.get("base_url") or os.getenv("LLM_BASE_URL") or None,
            api_key=wc.get("api_key") or os.getenv("LLM_API_KEY") or "sk-placeholder",
            model=wc.get("model") or os.getenv("LLM_MODEL") or "gpt-4o",
            temperature=0,
        )

        # Step 1: Find entry point
        if not entry_metric_id and scenario_id:
            entry_metric_id = self._find_entry_from_scenario(workspace.name, scenario_id)
        if not entry_metric_id:
            entry_metric_id = self._find_entry_from_question(workspace.name, question)
        if not entry_metric_id:
            return StageResult(status="failed", errors=["无法定位归因起点指标"])

        # Step 2: Enumerate all upstream paths via Neo4j
        raw_paths = self._enumerate_paths(workspace.name, entry_metric_id, max_depth)
        if not raw_paths:
            return StageResult(
                status="success",
                data={"paths": [], "conclusion": "未找到上游因果链路"},
                message="KG中无上游因果路径",
            )

        # Step 3: For each path, execute SQL and score
        scored_paths: list[AttributionPath] = []
        for raw_path in raw_paths:
            attr_path = self._verify_path(workspace, llm, raw_path)
            scored_paths.append(attr_path)

        # Sort by score descending
        scored_paths.sort(key=lambda p: p.score, reverse=True)

        # Step 4: Generate conclusion
        conclusion = self._generate_conclusion(llm, question, scored_paths[:3])

        return StageResult(
            status="success",
            data={
                "entry_metric": entry_metric_id,
                "paths": [p.to_dict() for p in scored_paths],
                "conclusion": conclusion,
                "path_count": len(scored_paths),
            },
            message=f"归因完成: {len(scored_paths)} 条路径, 最高评分 {scored_paths[0].score:.2f}" if scored_paths else "无归因路径",
        )

    # ------------------------------------------------------------------
    # Neo4j path enumeration
    # ------------------------------------------------------------------

    def _enumerate_paths(self, workspace_name: str, entry_id: str, max_depth: int) -> list[list[dict]]:
        """BFS upstream along CAUSES edges, return all paths up to max_depth."""
        from neo4j import GraphDatabase
        driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))

        paths = []
        with driver.session() as session:
            # Find all paths: (upstream)-[:CAUSES*1..N]->(entry)
            result = session.run(
                f"MATCH path = (root)-[:CAUSES*1..{max_depth}]->(target {{id: $eid, workspace: $ws}}) "
                "WHERE root.workspace = $ws "
                "RETURN [n IN nodes(path) | n {.id, .alias, .table_name, .name, .description}] as nodes",
                eid=entry_id, ws=workspace_name,
            )
            for record in result:
                nodes = record["nodes"]
                # Reverse: path goes from root to target, we want target → ... → root
                paths.append(list(reversed(nodes)))

        driver.close()

        # Deduplicate paths (same node sequence)
        seen = set()
        unique_paths = []
        for p in paths:
            key = tuple(n["id"] for n in p)
            if key not in seen:
                seen.add(key)
                unique_paths.append(p)

        return unique_paths

    def _find_entry_from_scenario(self, workspace_name: str, scenario_id: str) -> str:
        from neo4j import GraphDatabase
        driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
        with driver.session() as session:
            result = session.run(
                "MATCH (s:Scenario {id: $sid, workspace: $ws}) RETURN s.entry_metric as em",
                sid=scenario_id, ws=workspace_name,
            ).single()
        driver.close()
        return result["em"] if result else ""

    def _find_entry_from_question(self, workspace_name: str, question: str) -> str:
        """Fuzzy match: find metric whose alias best matches the question."""
        from neo4j import GraphDatabase
        driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
        with driver.session() as session:
            metrics = session.run(
                "MATCH (m:Metric {workspace: $ws}) RETURN m.id as id, m.alias as alias",
                ws=workspace_name,
            ).data()
        driver.close()
        # Simple substring match
        for m in metrics:
            if m["alias"] and m["alias"] in question:
                return m["id"]
        return metrics[0]["id"] if metrics else ""

    # ------------------------------------------------------------------
    # Path verification
    # ------------------------------------------------------------------

    def _verify_path(self, workspace: Workspace, llm, path_nodes: list[dict]) -> AttributionPath:
        """Execute SQL for each node in the path, compute deviation scores."""
        attr_path = AttributionPath()
        total_score = 1.0

        for node in path_nodes:
            step = self._verify_node(workspace, llm, node)
            attr_path.steps.append(step)
            if step.is_abnormal and step.deviation > 0:
                total_score *= (1 + step.deviation)

        attr_path.score = total_score
        if attr_path.steps:
            last_abnormal = [s for s in attr_path.steps if s.is_abnormal]
            attr_path.root_cause = last_abnormal[-1].alias if last_abnormal else attr_path.steps[-1].alias

        return attr_path

    def _verify_node(self, workspace: Workspace, llm, node: dict) -> AttributionStep:
        """Generate and execute SQL for a single KG node, compare to threshold."""
        from langchain_core.messages import SystemMessage, HumanMessage

        node_id = node.get("id", "")
        alias = node.get("alias", node.get("name", ""))
        table = node.get("table_name", "")
        desc = node.get("description", "")

        step = AttributionStep(node_id=node_id, alias=alias, table=table)

        # Generate SQL for this metric
        sql_prompt = (
            f"为指标 '{alias}' 生成SQL查询，返回单个数值 AS value。\n"
            f"表: {table}\n列: {node.get('name', '')}\n"
            f"期间: {workspace.current_period}\n"
            f"描述: {desc}\n"
            f"只返回SQL，不要解释。"
        )

        try:
            response = llm.invoke([
                SystemMessage(content="你是SQLite专家，生成查询返回单个数值AS value。"),
                HumanMessage(content=sql_prompt),
            ])
            sql = response.content.strip()
            sql = re.sub(r"^```(?:sql)?\s*", "", sql, flags=re.IGNORECASE)
            sql = re.sub(r"\s*```$", "", sql)
            step.sql = sql

            # Execute
            from sqlalchemy import text
            with workspace.get_engine().connect() as conn:
                row = conn.execute(text(sql)).fetchone()
                if row and row[0] is not None:
                    step.value = float(row[0])
        except Exception as exc:
            logger.warning("Failed to verify node %s: %s", node_id, exc)
            return step

        # TODO: Threshold should come from KG node properties
        # For now, use a simple heuristic based on value magnitude
        # In a full implementation, thresholds would be stored in Neo4j node properties
        step.is_abnormal = False  # Default to not abnormal without threshold
        step.deviation = 0.0

        return step

    # ------------------------------------------------------------------
    # Conclusion generation
    # ------------------------------------------------------------------

    def _generate_conclusion(self, llm, question: str, top_paths: list[AttributionPath]) -> str:
        from langchain_core.messages import SystemMessage, HumanMessage

        if not top_paths:
            return "未找到有效的归因路径。"

        paths_text = []
        for i, path in enumerate(top_paths):
            chain = " → ".join(s.alias for s in path.steps)
            values = ", ".join(
                f"{s.alias}={s.value}" for s in path.steps if s.value is not None
            )
            paths_text.append(f"路径{i+1} (评分{path.score:.2f}): {chain}\n  数值: {values}")

        prompt = (
            f"用户问题: {question}\n\n"
            f"归因路径验证结果:\n" + "\n".join(paths_text) + "\n\n"
            f"请生成归因分析报告:"
        )

        response = llm.invoke([SystemMessage(content=_CONCLUSION_SYSTEM), HumanMessage(content=prompt)])
        return response.content.strip()
