"""Stage 5: train_sql — auto-generate Q&A pairs from KG and train ChromaDB RAG."""
from __future__ import annotations

import json
import logging

from core.stage import StageBase, StageRegistry, StageResult
from knowledge.workspace import Workspace

logger = logging.getLogger(__name__)


@StageRegistry.register
class TrainSqlStage(StageBase):
    name = "train_sql"
    display_name = "SQL RAG 训练"
    description = "从 KG 自动生成 Q&A 训练对，训练 ChromaDB 检索索引"
    pipeline_type = "setup"
    order = 5

    def run(self, workspace: Workspace, input_data: dict, config: dict) -> StageResult:
        from core.persistence import load_stage_result
        from knowledge.vanna_store import get_sql_rag, SqlRagStore
        from knowledge.schema_builder import build_ddl, build_rules_context

        # Load KG
        kg_result = load_stage_result(workspace.workspace_dir, "build_kg")
        if not kg_result:
            return StageResult(status="failed", errors=["build_kg stage not completed"])

        kg = kg_result["data"]

        # Clear existing RAG store and rebuild
        store = self._get_fresh_store(workspace)
        if store is None:
            return StageResult(status="failed", errors=["ChromaDB not available"])

        count = 0
        auto_generated = []

        # 1. Add DDL documentation
        ddl = build_ddl(workspace)
        if ddl:
            store.add_documentation(ddl, doc_id="ddl")

        # 2. Add business rules
        rules = build_rules_context(workspace)
        if rules:
            store.add_documentation(rules, doc_id="rules")

        # 3. Auto-generate Q&A from KG metrics
        metrics = [n for n in kg.get("nodes", []) if n.get("type") == "metric"]
        for m in metrics:
            alias = m.get("alias", m["name"])
            table = m.get("table", "")
            col = m.get("name", "")
            if not table or not col:
                continue

            # Simple aggregation question
            q = f"本月{alias}是多少？"
            sql = self._gen_metric_sql(table, col, workspace.current_period)
            if sql:
                store.add_example(q, sql, {"type": "auto", "metric_id": m["id"]})
                auto_generated.append({"question": q, "sql": sql})
                count += 1

        # 4. Auto-generate drilldown Q&A
        drilldowns = kg.get("edges", {}).get("drilldown", [])
        for dd in drilldowns:
            metric_id = dd.get("metric", "")
            dim_id = dd.get("dimension", "")
            metric_node = next((n for n in metrics if n["id"] == metric_id), None)
            dim_node = next((n for n in kg["nodes"] if n["id"] == dim_id), None)
            if not metric_node or not dim_node:
                continue

            q = f"按{dim_node.get('alias', dim_node['name'])}看{metric_node.get('alias', metric_node['name'])}"
            sql = self._gen_drilldown_sql(
                metric_node["table"], metric_node["name"],
                dim_node["table"], dim_node["name"],
                workspace.current_period
            )
            if sql:
                store.add_example(q, sql, {"type": "auto_drilldown"})
                auto_generated.append({"question": q, "sql": sql})
                count += 1

        # 5. Add manual few_shots
        manual_count = 0
        try:
            few_shots = workspace.get_few_shots()
            for ex in few_shots.get("examples", []):
                q, sql = ex.get("question", ""), ex.get("sql", "")
                if q and sql:
                    store.add_example(q, sql, {"type": "manual", "scenario": ex.get("scenario", "")})
                    manual_count += 1
                    count += 1
        except FileNotFoundError:
            pass

        # Save auto-generated examples to few_shots_auto.json
        auto_path = workspace.workspace_dir / "few_shots_auto.json"
        auto_path.write_text(
            json.dumps({"examples": auto_generated}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        return StageResult(
            status="success",
            data={
                "total_indexed": count,
                "auto_generated": len(auto_generated),
                "manual_examples": manual_count,
            },
            artifacts=[str(auto_path)],
            message=f"SQL RAG 训练完成: {count} 条索引（自动 {len(auto_generated)} + 手工 {manual_count}）",
        )

    def _get_fresh_store(self, workspace: Workspace):
        """Get a fresh ChromaDB store, clearing existing data."""
        try:
            from knowledge.vanna_store import SqlRagStore, _CACHE
            # Clear cache
            _CACHE.pop(workspace.name, None)
            # Delete existing ChromaDB data
            from knowledge.vanna_store import CHROMA_DIR
            import shutil
            chroma_path = CHROMA_DIR / workspace.name
            if chroma_path.exists():
                shutil.rmtree(chroma_path)
            return SqlRagStore(workspace.name)
        except Exception as exc:
            logger.warning("Failed to create SqlRagStore: %s", exc)
            return None

    def _gen_metric_sql(self, table: str, col: str, period: str) -> str:
        """Generate a simple aggregation SQL for a metric."""
        # Detect period column
        period_filter = self._period_filter(table, period)
        return f"SELECT ROUND(SUM({col}), 2) AS value FROM {table}{period_filter}"

    def _gen_drilldown_sql(self, metric_table: str, metric_col: str,
                           dim_table: str, dim_col: str, period: str) -> str:
        """Generate a GROUP BY SQL for drilldown."""
        if metric_table == dim_table:
            period_filter = self._period_filter(metric_table, period)
            return (
                f"SELECT {dim_col}, ROUND(SUM({metric_col}), 2) AS value "
                f"FROM {metric_table}{period_filter} "
                f"GROUP BY {dim_col} ORDER BY value DESC LIMIT 20"
            )
        return ""

    def _period_filter(self, table: str, period: str) -> str:
        """Return appropriate WHERE clause for period filtering."""
        if not period:
            return ""
        # Known date column patterns
        if table in ("sales_delivery",):
            return f" WHERE strftime('%Y%m', deliv_crt_time) = '{period}'"
        elif table in ("sales_order",):
            return f" WHERE strftime('%Y%m', order_crt_date) = '{period}'"
        elif table in ("rolling_plan",):
            return f" WHERE stats_yearmth = '{period}'"
        elif table in ("production_output",):
            return f" WHERE record_yearmth = '{period}'"
        elif table in ("inventory",):
            return f" WHERE snapshot_yearmth = '{period}'"
        # Generic: try common yearmth column patterns
        return ""
