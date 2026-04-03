"""Schema builder — converts schema_dict.yaml into strings for LLM/Vanna.

Three public functions:
  - build_ddl(workspace)            → CREATE TABLE statements (Vanna training)
  - build_schema_context(workspace) → compact table+field description (LLM prompt)
  - build_rules_context(workspace)  → business rules + query term map (SQL prompt)

Usage::
    from knowledge.schema_builder import build_ddl, build_schema_context, build_rules_context
    ddl     = build_ddl(workspace)
    schema  = build_schema_context(workspace)
    rules   = build_rules_context(workspace)
"""
from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from knowledge.workspace import Workspace


# ---------------------------------------------------------------------------
# Type mapping
# ---------------------------------------------------------------------------

_TYPE_MAP: dict[str, str] = {
    "string":   "TEXT",
    "integer":  "INTEGER",
    "float":    "REAL",
    "date":     "DATE",
    "datetime": "DATETIME",
}


def _sql_type(field_type: str) -> str:
    return _TYPE_MAP.get(field_type.lower(), "TEXT")


# ---------------------------------------------------------------------------
# Public functions
# ---------------------------------------------------------------------------

def build_ddl(workspace: "Workspace") -> str:
    """Generate CREATE TABLE statements from schema_dict.yaml for Vanna training.

    Each table in the 'tables:' section becomes one CREATE TABLE block.
    Column comments use the field's Chinese alias for readability.

    Returns:
        A string containing one or more CREATE TABLE statements separated by
        blank lines.  Returns an empty string if no tables are defined.
    """
    schema = workspace.get_schema_dict()
    tables: dict = schema.get("tables", {})
    if not tables:
        return ""

    blocks: list[str] = []
    for tbl_name, tbl_meta in tables.items():
        alias = tbl_meta.get("alias", "")
        description = tbl_meta.get("description", "")
        fields: dict = tbl_meta.get("fields", {})

        header_comment = f"-- {alias}: {description}" if alias or description else ""
        col_defs: list[str] = []
        for col_name, col_meta in fields.items():
            col_type = _sql_type(col_meta.get("type", "string"))
            col_alias = col_meta.get("alias", col_name)
            col_desc = col_meta.get("description", "")
            inline = f"{col_alias}" + (f" — {col_desc}" if col_desc else "")
            col_defs.append(f"    {col_name:<40} {col_type:<12} -- {inline}")

        lines: list[str] = []
        if header_comment:
            lines.append(header_comment)
        lines.append(f"CREATE TABLE {tbl_name} (")
        lines.append(",\n".join(col_defs))
        lines.append(");")
        blocks.append("\n".join(lines))

    return "\n\n".join(blocks)


def build_schema_context(workspace: "Workspace") -> str:
    """Generate a condensed text description of tables + fields for LLM prompts.

    The output is plain text formatted to be inserted into a system prompt.
    It lists each table with its Chinese name, description, and a brief
    one-liner per field (alias + type + first sentence of description).

    Returns:
        Multi-line string, one section per table.
    """
    schema = workspace.get_schema_dict()
    tables: dict = schema.get("tables", {})
    relationships: list = schema.get("table_relationships", [])

    parts: list[str] = ["=== 数据库表结构 ==="]

    for tbl_name, tbl_meta in tables.items():
        alias = tbl_meta.get("alias", tbl_name)
        description = tbl_meta.get("description", "")
        granularity = tbl_meta.get("row_granularity", "")
        fields: dict = tbl_meta.get("fields", {})

        parts.append(f"\n[{tbl_name}] {alias}")
        if description:
            parts.append(f"  说明: {description}")
        if granularity:
            parts.append(f"  粒度: {granularity}")
        parts.append("  字段:")
        for col_name, col_meta in fields.items():
            col_alias = col_meta.get("alias", col_name)
            col_type = col_meta.get("type", "")
            # Use only the first sentence of the description to keep it compact
            col_desc_full = col_meta.get("description", "")
            col_desc = col_desc_full.split("。")[0].split(".")[0]
            type_tag = f"[{col_type}]" if col_type else ""
            parts.append(f"    {col_name} {type_tag} — {col_alias}: {col_desc}")

    if relationships:
        parts.append("\n=== 表关联关系 ===")
        for rel in relationships:
            name = rel.get("name", "")
            on = rel.get("on", "")
            note = rel.get("note", "")
            parts.append(f"  {name}: {on}")
            if note:
                parts.append(f"    注意: {note}")

    # Add current reporting period hint
    period = workspace.current_period
    if period:
        parts.append(f"\n=== 当前报告期 ===\n  {period}（SQL中用 '{period}' 代替本月）")

    return "\n".join(parts)


def build_rules_context(workspace: "Workspace") -> str:
    """Return business rules and query term mappings as plain text for SQL prompts.

    The output is intended to be appended to a SQL-generation system prompt so
    the LLM knows domain-specific filter rules (e.g. exclude returns, join keys)
    and how to translate Chinese terms into SQL expressions.

    Returns:
        Multi-line string with two sections: business rules and term mappings.
        Returns an empty string if no rules are defined.
    """
    schema = workspace.get_schema_dict()
    rules: dict = schema.get("business_rules", {})
    term_map: dict = schema.get("query_term_mapping", {})

    parts: list[str] = []

    if rules:
        parts.append("=== 业务规则（生成SQL时必须遵守） ===")
        for rule_name, rule_body in rules.items():
            if isinstance(rule_body, dict):
                rule_text = rule_body.get("rule", "")
                rule_desc = rule_body.get("description", "")
                example_sql = rule_body.get("example_sql", "")
                parts.append(f"\n[{rule_name}]")
                if rule_text:
                    parts.append(f"  规则: {rule_text}")
                if rule_desc:
                    parts.append(f"  说明: {rule_desc}")
                if example_sql:
                    # Indent multi-line example SQL
                    sql_lines = str(example_sql).strip().splitlines()
                    parts.append("  示例SQL:")
                    for line in sql_lines:
                        parts.append(f"    {line}")
            else:
                parts.append(f"\n[{rule_name}] {rule_body}")

    if term_map:
        parts.append("\n=== 常用中文查询词 → SQL映射 ===")
        for term, mapping in term_map.items():
            parts.append(f'  "{term}" → {mapping}')

    return "\n".join(parts)
