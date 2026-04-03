"""Stage 6: text_to_sql — KG-guided SQL generation + execution + interpretation.

Runtime stage: runs per user question. Uses KG subgraph retrieval to focus
the schema context, then generates SQL via LLM.
"""
from __future__ import annotations

import json
import os
import re
import logging

from dotenv import load_dotenv

from core.stage import StageBase, StageRegistry, StageResult
from knowledge.workspace import Workspace

load_dotenv()
logger = logging.getLogger(__name__)

NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "dataagent")

_SQL_SYSTEM = """\
你是数据分析SQL专家。根据用户问题和数据库schema生成SQLite查询。
要求：
- 只返回SQL，不要解释
- 使用schema中的实际列名
- 数值结果用ROUND()保留2位小数
- 排除退货记录（deliv_retrngds_identfctn IS NULL）
- 日期过滤使用正确的函数（见schema说明）"""

_INTERPRET_SYSTEM = """\
你是供应链数据分析专顾问。用简洁的中文业务语言解读查询结果。
要求：凸显异常值，给出可落地建议，200字以内。"""


@StageRegistry.register
class TextToSqlStage(StageBase):
    name = "text_to_sql"
    display_name = "智能问数"
    description = "KG引导的SQL生成 + 执行 + 解读"
    pipeline_type = "runtime"
    order = 6

    def run(self, workspace: Workspace, input_data: dict, config: dict) -> StageResult:
        question = input_data.get("question", "")
        if not question:
            return StageResult(status="failed", errors=["question is required"])

        from langchain_openai import ChatOpenAI
        from langchain_core.messages import SystemMessage, HumanMessage

        wc = workspace.llm_config
        llm = ChatOpenAI(
            base_url=wc.get("base_url") or os.getenv("LLM_BASE_URL") or None,
            api_key=wc.get("api_key") or os.getenv("LLM_API_KEY") or "sk-placeholder",
            model=wc.get("model") or os.getenv("LLM_MODEL") or "gpt-4o",
            temperature=0,
        )

        # Step 1: KG subgraph retrieval
        kg_context = self._retrieve_kg_context(workspace.name, question)

        # Step 2: Get focused schema context
        schema_context = self._build_focused_schema(workspace, kg_context)

        # Step 3: RAG few-shot retrieval
        few_shots_text = self._get_few_shots(workspace, question)

        # Step 4: Generate SQL
        sql_prompt = f"""{schema_context}

{few_shots_text}

当前报告期: {workspace.current_period}

用户问题: {question}

生成一条SQLite查询语句:"""

        response = llm.invoke([SystemMessage(content=_SQL_SYSTEM), HumanMessage(content=sql_prompt)])
        sql = self._clean_sql(response.content)

        # Step 5: Execute SQL
        exec_result = self._execute_sql(workspace, sql)

        # Step 6: Interpret result
        interpretation = ""
        if exec_result.get("rows") and not exec_result.get("error"):
            interp_prompt = (
                f"用户问: {question}\n\n"
                f"SQL: {sql}\n\n"
                f"查询结果:\n列: {exec_result['columns']}\n"
                f"数据（前20行）: {json.dumps(exec_result['rows'][:20], ensure_ascii=False)}\n\n"
                f"请用业务语言解读:"
            )
            interp_resp = llm.invoke([
                SystemMessage(content=_INTERPRET_SYSTEM),
                HumanMessage(content=interp_prompt),
            ])
            interpretation = interp_resp.content.strip()

        return StageResult(
            status="success",
            data={
                "question": question,
                "sql": sql,
                "result": exec_result,
                "interpretation": interpretation,
                "kg_context": {
                    "matched_metrics": [n.get("alias", n.get("name", "")) for n in kg_context.get("metrics", [])],
                    "matched_dimensions": [n.get("alias", n.get("name", "")) for n in kg_context.get("dimensions", [])],
                    "matched_scenario": kg_context.get("scenario"),
                },
            },
            message=f"SQL执行成功: {exec_result.get('row_count', 0)} 行结果",
        )

    # ------------------------------------------------------------------
    # KG retrieval via Neo4j
    # ------------------------------------------------------------------

    def _retrieve_kg_context(self, workspace_name: str, question: str) -> dict:
        """Find relevant metrics, dimensions, and scenario from Neo4j."""
        from neo4j import GraphDatabase

        driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
        context = {"metrics": [], "dimensions": [], "tables": set(), "scenario": None}

        with driver.session() as session:
            # Match scenario by keywords
            scenarios = session.run(
                "MATCH (s:Scenario {workspace: $ws}) RETURN s",
                ws=workspace_name,
            ).data()
            for sc in scenarios:
                s = sc["s"]
                keywords = json.loads(s.get("keywords", "[]"))
                if any(kw in question for kw in keywords):
                    context["scenario"] = {
                        "id": s["id"], "title": s["title"],
                        "entry_metric": s.get("entry_metric", ""),
                    }
                    break

            # Match metrics by alias/name substring
            metrics = session.run(
                "MATCH (m:Metric {workspace: $ws}) "
                "WHERE m.alias CONTAINS $q OR m.description CONTAINS $q "
                "RETURN m LIMIT 10",
                ws=workspace_name, q=question[:20],
            ).data()
            for m in metrics:
                node = m["m"]
                context["metrics"].append(dict(node))
                context["tables"].add(node.get("table_name", ""))

            # If scenario matched, also get its entry metric and upstream
            if context["scenario"] and context["scenario"]["entry_metric"]:
                entry_id = context["scenario"]["entry_metric"]
                # Get entry metric and 1-hop causal neighbors
                upstream = session.run(
                    "MATCH (m {id: $mid, workspace: $ws})"
                    "OPTIONAL MATCH (upstream)-[:CAUSES]->(m) "
                    "OPTIONAL MATCH (m)-[:CAUSES]->(downstream) "
                    "RETURN m, collect(DISTINCT upstream) as up, collect(DISTINCT downstream) as down",
                    mid=entry_id, ws=workspace_name,
                ).single()
                if upstream:
                    entry_node = upstream["m"]
                    if entry_node:
                        context["metrics"].append(dict(entry_node))
                        context["tables"].add(entry_node.get("table_name", ""))
                    for n in upstream["up"] + upstream["down"]:
                        if n:
                            context["metrics"].append(dict(n))
                            context["tables"].add(n.get("table_name", ""))

            # Get relevant dimensions for matched tables
            table_list = list(context["tables"])
            if table_list:
                dims = session.run(
                    "MATCH (d:Dimension {workspace: $ws}) "
                    "WHERE d.table_name IN $tables "
                    "RETURN d LIMIT 20",
                    ws=workspace_name, tables=table_list,
                ).data()
                for d in dims:
                    context["dimensions"].append(dict(d["d"]))

        driver.close()
        context["tables"] = list(context["tables"])
        return context

    # ------------------------------------------------------------------
    # Focused schema context
    # ------------------------------------------------------------------

    def _build_focused_schema(self, workspace: Workspace, kg_context: dict) -> str:
        """Build schema context focused on KG-matched tables only."""
        schema = workspace.get_schema_dict()
        all_tables = schema.get("tables", {})
        matched_tables = set(kg_context.get("tables", []))

        # Always include tables mentioned in KG; if none matched, use all
        if not matched_tables:
            matched_tables = set(all_tables.keys())

        parts = ["=== 数据库表结构（KG匹配） ==="]
        for tbl_name in matched_tables:
            tbl = all_tables.get(tbl_name)
            if not tbl:
                continue
            alias = tbl.get("alias", tbl_name)
            desc = tbl.get("description", "")
            parts.append(f"\n[{tbl_name}] {alias}")
            if desc:
                parts.append(f"  说明: {desc}")
            fields = tbl.get("fields", {})
            for col, col_info in fields.items():
                col_alias = col_info.get("alias", col)
                col_type = col_info.get("type", "")
                parts.append(f"    {col} [{col_type}] — {col_alias}")

        # Add rules
        rules = schema.get("business_rules", {})
        if rules:
            parts.append("\n=== 业务规则 ===")
            for name, rule in rules.items():
                if isinstance(rule, dict):
                    parts.append(f"  {name}: {rule.get('rule', '')}")
                else:
                    parts.append(f"  {name}: {rule}")

        # Add relationships
        rels = schema.get("table_relationships", [])
        if rels:
            parts.append("\n=== 表关联 ===")
            for r in rels:
                parts.append(f"  {r.get('name','')}: {r.get('on','')}")

        return "\n".join(parts)

    # ------------------------------------------------------------------
    # RAG few-shot
    # ------------------------------------------------------------------

    def _get_few_shots(self, workspace: Workspace, question: str) -> str:
        from knowledge.vanna_store import get_sql_rag
        rag = get_sql_rag(workspace)
        if not rag:
            return ""
        matches = rag.retrieve(question, n_results=3)
        if not matches:
            return ""
        lines = ["=== 参考示例 ==="]
        for m in matches:
            lines.append(f"  Q: {m.get('question', '')}")
            lines.append(f"  SQL: {m.get('sql', '')}")
            lines.append("")
        return "\n".join(lines)

    # ------------------------------------------------------------------
    # SQL execution
    # ------------------------------------------------------------------

    def _execute_sql(self, workspace: Workspace, sql: str) -> dict:
        from sqlalchemy import text
        try:
            engine = workspace.get_engine()
            with engine.connect() as conn:
                result = conn.execute(text(sql))
                columns = list(result.keys())
                rows = [list(row) for row in result.fetchall()]
                return {"columns": columns, "rows": rows[:200], "row_count": len(rows)}
        except Exception as exc:
            return {"columns": [], "rows": [], "row_count": 0, "error": str(exc)}

    def _clean_sql(self, raw: str) -> str:
        raw = raw.strip()
        raw = re.sub(r"^```(?:sql)?\s*", "", raw, flags=re.IGNORECASE)
        raw = re.sub(r"\s*```$", "", raw)
        return raw.strip()
