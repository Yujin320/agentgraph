"""Stage 2: introspect — auto-discover schema, column stats, FK inference."""
from __future__ import annotations

from core.stage import StageBase, StageRegistry, StageResult
from knowledge.workspace import Workspace


@StageRegistry.register
class IntrospectStage(StageBase):
    name = "introspect"
    display_name = "Schema 自动发现"
    description = "自动发现表结构、列统计、外键关系、列角色"
    pipeline_type = "setup"
    order = 2

    def get_default_config(self) -> dict:
        return {"sample_size": 5, "max_distinct_for_dimension": 100}

    def run(self, workspace: Workspace, input_data: dict, config: dict) -> StageResult:
        from sqlalchemy import inspect, text

        sample_size = config.get("sample_size", 5)
        max_distinct = config.get("max_distinct_for_dimension", 100)

        engine = workspace.get_engine()
        insp = inspect(engine)
        table_names = insp.get_table_names()

        # Filter by whitelist if configured
        allowed = workspace._config.get("tables")
        if allowed:
            table_names = [t for t in table_names if t in allowed]

        tables = {}
        all_columns_by_name: dict[str, list[str]] = {}  # col_name → [table.col, ...]

        for tbl in table_names:
            columns_info = insp.get_columns(tbl)
            pk_cols = insp.get_pk_constraint(tbl).get("constrained_columns", [])
            fk_list = insp.get_foreign_keys(tbl)

            # Row count
            with engine.connect() as conn:
                row_count = conn.execute(text(f'SELECT COUNT(*) FROM "{tbl}"')).fetchone()[0]

            cols = {}
            for col in columns_info:
                col_name = col["name"]
                col_type = str(col["type"])
                nullable = col.get("nullable", True)

                # Column statistics
                stats = self._column_stats(engine, tbl, col_name, col_type, max_distinct)

                # Infer column role
                role = self._infer_role(col_type, stats, pk_cols, col_name, max_distinct)

                cols[col_name] = {
                    "type": col_type,
                    "nullable": nullable,
                    "is_pk": col_name in pk_cols,
                    "stats": stats,
                    "role": role,
                }

                # Track for FK inference
                all_columns_by_name.setdefault(col_name, []).append(f"{tbl}.{col_name}")

            # Sample rows
            with engine.connect() as conn:
                rows = conn.execute(text(f'SELECT * FROM "{tbl}" LIMIT {sample_size}')).fetchall()
                col_names = [c["name"] for c in columns_info]
                sample = [dict(zip(col_names, row)) for row in rows]

            tables[tbl] = {
                "row_count": row_count,
                "columns": cols,
                "declared_fks": [
                    {"from": f"{tbl}.{fk['constrained_columns']}", "to": f"{fk['referred_table']}.{fk['referred_columns']}"}
                    for fk in fk_list
                ],
                "sample_rows": sample,
            }

        # Infer FK relationships from shared column names
        inferred_fks = self._infer_fks(all_columns_by_name, tables, engine)

        total_rows = sum(t["row_count"] for t in tables.values())
        total_cols = sum(len(t["columns"]) for t in tables.values())

        return StageResult(
            status="success",
            data={"tables": tables, "inferred_fks": inferred_fks},
            message=f"发现 {len(tables)} 张表, {total_cols} 个字段, {total_rows:,} 行数据, {len(inferred_fks)} 个推断外键",
        )

    def _column_stats(self, engine, tbl: str, col: str, col_type: str, max_distinct: int) -> dict:
        from sqlalchemy import text
        stats: dict = {}
        try:
            with engine.connect() as conn:
                # Cardinality and null count
                r = conn.execute(text(
                    f'SELECT COUNT(DISTINCT "{col}") as cd, '
                    f'SUM(CASE WHEN "{col}" IS NULL THEN 1 ELSE 0 END) as nulls, '
                    f'COUNT(*) as total FROM "{tbl}"'
                )).fetchone()
                cardinality, null_count, total = r[0], r[1], r[2]
                stats["cardinality"] = cardinality
                stats["null_pct"] = round(null_count / total * 100, 1) if total else 0

                # Numeric stats
                type_upper = col_type.upper()
                if any(t in type_upper for t in ("INT", "REAL", "FLOAT", "NUMERIC", "DECIMAL", "DOUBLE")):
                    r2 = conn.execute(text(
                        f'SELECT MIN("{col}"), MAX("{col}"), AVG("{col}") FROM "{tbl}" WHERE "{col}" IS NOT NULL'
                    )).fetchone()
                    if r2[0] is not None:
                        stats["min"] = r2[0]
                        stats["max"] = r2[1]
                        stats["avg"] = round(r2[2], 2) if r2[2] is not None else None

                # Top distinct values for low-cardinality columns
                if cardinality <= max_distinct and cardinality > 0:
                    rows = conn.execute(text(
                        f'SELECT "{col}", COUNT(*) as cnt FROM "{tbl}" '
                        f'WHERE "{col}" IS NOT NULL GROUP BY "{col}" ORDER BY cnt DESC LIMIT 10'
                    )).fetchall()
                    stats["top_values"] = [{"value": str(r[0]), "count": r[1]} for r in rows]

        except Exception:
            pass
        return stats

    def _infer_role(self, col_type: str, stats: dict, pk_cols: list, col_name: str, max_distinct: int) -> str:
        if col_name in pk_cols:
            return "primary_key"

        type_upper = col_type.upper()
        is_numeric = any(t in type_upper for t in ("INT", "REAL", "FLOAT", "NUMERIC", "DECIMAL", "DOUBLE"))
        cardinality = stats.get("cardinality", 0)

        # ID-like columns
        if col_name.lower().endswith(("_id", "_code", "num", "_key")):
            return "identifier"

        # Date/time columns
        if any(t in type_upper for t in ("DATE", "TIME", "TIMESTAMP")):
            return "time"

        # Numeric + high cardinality → measure
        if is_numeric and cardinality > max_distinct:
            return "measure"

        # Numeric but low cardinality → could be a flag/status
        if is_numeric and cardinality <= 10:
            return "flag"

        # Text + low cardinality → dimension
        if not is_numeric and cardinality <= max_distinct:
            return "dimension"

        # Text + high cardinality → attribute
        return "attribute"

    def _infer_fks(self, columns_by_name: dict, tables: dict, engine) -> list[dict]:
        """Infer FK relationships from shared column names across tables."""
        from sqlalchemy import text
        fks = []
        seen = set()

        for col_name, locations in columns_by_name.items():
            if len(locations) < 2:
                continue
            # Skip common generic names
            if col_name.lower() in ("id", "name", "type", "status", "description"):
                continue

            for i, loc_a in enumerate(locations):
                for loc_b in locations[i + 1:]:
                    tbl_a, _ = loc_a.split(".")
                    tbl_b, _ = loc_b.split(".")
                    key = tuple(sorted([loc_a, loc_b]))
                    if key in seen:
                        continue
                    seen.add(key)

                    # Check value overlap
                    confidence = self._value_overlap(engine, tbl_a, tbl_b, col_name)
                    if confidence > 0.3:
                        fks.append({
                            "from": loc_a,
                            "to": loc_b,
                            "column": col_name,
                            "confidence": round(confidence, 2),
                        })
        return sorted(fks, key=lambda x: -x["confidence"])

    def _value_overlap(self, engine, tbl_a: str, tbl_b: str, col: str) -> float:
        """Jaccard similarity of distinct values between two columns."""
        from sqlalchemy import text
        try:
            with engine.connect() as conn:
                a_vals = {r[0] for r in conn.execute(text(
                    f'SELECT DISTINCT "{col}" FROM "{tbl_a}" WHERE "{col}" IS NOT NULL LIMIT 500'
                )).fetchall()}
                b_vals = {r[0] for r in conn.execute(text(
                    f'SELECT DISTINCT "{col}" FROM "{tbl_b}" WHERE "{col}" IS NOT NULL LIMIT 500'
                )).fetchall()}
                if not a_vals or not b_vals:
                    return 0.0
                intersection = len(a_vals & b_vals)
                union = len(a_vals | b_vals)
                return intersection / union if union else 0.0
        except Exception:
            return 0.0
