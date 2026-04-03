"""Stage 3: enrich — LLM semantic enrichment of raw schema."""
from __future__ import annotations

import json
import os
import yaml
from pathlib import Path

from dotenv import load_dotenv

from core.stage import StageBase, StageRegistry, StageResult
from knowledge.workspace import Workspace

load_dotenv()

_SYSTEM_PROMPT = """\
你是数据治理专家，擅长为数据库字段添加中文语义标注。
根据表结构、字段统计和样本数据，生成完整的语义字典。
返回严格的 JSON 格式，不要添加 markdown 代码块。"""

_TABLE_PROMPT = """\
请为以下数据库表生成语义标注。

表名: {table_name}
行数: {row_count}

列信息:
{columns_info}

样本数据（前5行）:
{sample_rows}

请返回 JSON：
{{
  "alias": "表的中文名称",
  "description": "一句话说明这张表记录什么业务数据",
  "row_granularity": "每行代表什么（如：每行=一条提单记录）",
  "fields": {{
    "字段名": {{
      "alias": "中文别名",
      "type": "string|integer|float|date|datetime",
      "description": "业务含义说明",
      "important": "注意事项（可选，如特殊过滤条件）"
    }}
  }}
}}"""

_RULES_PROMPT = """\
基于以下已标注的表结构，推断业务规则、表关联关系和查询词映射。

表结构摘要:
{schema_summary}

推断的外键关系:
{inferred_fks}

请返回 JSON：
{{
  "business_rules": {{
    "规则名": {{
      "rule": "规则表达式",
      "description": "说明",
      "table": "涉及的表",
      "example_sql": "示例SQL"
    }}
  }},
  "table_relationships": [
    {{
      "name": "关系名称",
      "left": "左表",
      "right": "右表",
      "join_type": "LEFT JOIN",
      "on": "JOIN条件",
      "note": "注意事项"
    }}
  ],
  "query_term_mapping": {{
    "中文词": "SQL表达式或字段名"
  }}
}}"""


@StageRegistry.register
class EnrichStage(StageBase):
    name = "enrich"
    display_name = "语义标注"
    description = "LLM 自动生成中文别名、业务描述、规则；需人工审核"
    pipeline_type = "setup"
    order = 3

    def run(self, workspace: Workspace, input_data: dict, config: dict) -> StageResult:
        from langchain_openai import ChatOpenAI
        from langchain_core.messages import SystemMessage, HumanMessage

        # Load introspect result
        from core.persistence import load_stage_result
        introspect = load_stage_result(workspace.workspace_dir, "introspect")
        if not introspect or introspect.get("status") != "success":
            return StageResult(status="failed", errors=["introspect stage not completed"])

        tables_data = introspect["data"]["tables"]
        inferred_fks = introspect["data"].get("inferred_fks", [])

        wc = workspace.llm_config
        llm = ChatOpenAI(
            base_url=wc.get("base_url") or os.getenv("LLM_BASE_URL") or None,
            api_key=wc.get("api_key") or os.getenv("LLM_API_KEY") or "sk-placeholder",
            model=wc.get("model") or os.getenv("LLM_MODEL") or "gpt-4o",
            temperature=0,
        )

        schema_dict = {"tables": {}}
        errors = []

        # Enrich each table
        for tbl_name, tbl_data in tables_data.items():
            try:
                result = self._enrich_table(llm, tbl_name, tbl_data)
                schema_dict["tables"][tbl_name] = result
            except Exception as exc:
                errors.append(f"Table {tbl_name}: {exc}")
                # Fallback: auto-generate minimal schema
                schema_dict["tables"][tbl_name] = self._fallback_schema(tbl_name, tbl_data)

        # Infer business rules and relationships
        try:
            rules_result = self._infer_rules(llm, schema_dict["tables"], inferred_fks)
            schema_dict.update(rules_result)
        except Exception as exc:
            errors.append(f"Rules inference: {exc}")
            schema_dict["business_rules"] = {}
            schema_dict["table_relationships"] = []
            schema_dict["query_term_mapping"] = {}

        # Write schema_dict.yaml
        out_path = workspace.workspace_dir / "schema_dict.yaml"
        with open(out_path, "w", encoding="utf-8") as f:
            yaml.dump(schema_dict, f, allow_unicode=True, default_flow_style=False, width=120)

        return StageResult(
            status="needs_review",
            data=schema_dict,
            artifacts=[str(out_path)],
            message=f"已标注 {len(schema_dict['tables'])} 张表，请审核后继续",
            errors=errors,
        )

    def _enrich_table(self, llm, tbl_name: str, tbl_data: dict) -> dict:
        from langchain_core.messages import SystemMessage, HumanMessage

        # Format columns info
        cols_lines = []
        for col_name, col_info in tbl_data["columns"].items():
            stats = col_info.get("stats", {})
            role = col_info.get("role", "")
            line = f"  {col_name} ({col_info['type']}) role={role}"
            if "cardinality" in stats:
                line += f" cardinality={stats['cardinality']}"
            if "top_values" in stats:
                vals = [v["value"] for v in stats["top_values"][:5]]
                line += f" samples={vals}"
            if "min" in stats:
                line += f" range=[{stats['min']}, {stats['max']}]"
            cols_lines.append(line)

        # Format sample rows
        samples = tbl_data.get("sample_rows", [])
        sample_str = json.dumps(samples[:3], ensure_ascii=False, indent=2) if samples else "(no samples)"

        prompt = _TABLE_PROMPT.format(
            table_name=tbl_name,
            row_count=tbl_data.get("row_count", "?"),
            columns_info="\n".join(cols_lines),
            sample_rows=sample_str,
        )

        response = llm.invoke([SystemMessage(content=_SYSTEM_PROMPT), HumanMessage(content=prompt)])
        return self._parse_json(response.content)

    def _infer_rules(self, llm, tables: dict, inferred_fks: list) -> dict:
        from langchain_core.messages import SystemMessage, HumanMessage

        # Build summary
        summary_lines = []
        for tbl_name, tbl_info in tables.items():
            alias = tbl_info.get("alias", tbl_name)
            fields = tbl_info.get("fields", {})
            field_names = [f"{k}({v.get('alias', k)})" for k, v in list(fields.items())[:10]]
            summary_lines.append(f"  {tbl_name} [{alias}]: {', '.join(field_names)}")

        fk_lines = [f"  {fk['from']} → {fk['to']} (confidence={fk.get('confidence', '?')})" for fk in inferred_fks[:20]]

        prompt = _RULES_PROMPT.format(
            schema_summary="\n".join(summary_lines),
            inferred_fks="\n".join(fk_lines) or "(none detected)",
        )

        response = llm.invoke([SystemMessage(content=_SYSTEM_PROMPT), HumanMessage(content=prompt)])
        return self._parse_json(response.content)

    def _fallback_schema(self, tbl_name: str, tbl_data: dict) -> dict:
        """Generate minimal schema without LLM."""
        fields = {}
        for col_name, col_info in tbl_data["columns"].items():
            col_type_str = col_info["type"].upper()
            if "INT" in col_type_str:
                t = "integer"
            elif any(x in col_type_str for x in ("REAL", "FLOAT", "NUMERIC", "DECIMAL")):
                t = "float"
            elif "DATE" in col_type_str or "TIME" in col_type_str:
                t = "datetime"
            else:
                t = "string"
            fields[col_name] = {"alias": col_name, "type": t, "description": ""}
        return {"alias": tbl_name, "description": "", "row_granularity": "", "fields": fields}

    def _parse_json(self, raw: str) -> dict:
        """Extract JSON from LLM response, handling markdown fences."""
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
            raise
