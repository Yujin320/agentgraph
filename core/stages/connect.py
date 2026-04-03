"""Stage 1: connect — validate data source connection."""
from __future__ import annotations

from core.stage import StageBase, StageRegistry, StageResult
from knowledge.workspace import Workspace


@StageRegistry.register
class ConnectStage(StageBase):
    name = "connect"
    display_name = "数据源连接"
    description = "验证数据库连接，获取基本信息"
    pipeline_type = "setup"
    order = 1

    def validate_input(self, workspace: Workspace, input_data: dict) -> list[str]:
        # db_url can come from input or workspace.yaml
        db_url = input_data.get("db_url") or workspace._config.get("database", {}).get("url")
        if not db_url:
            return ["db_url is required (pass in input or set in workspace.yaml)"]
        return []

    def run(self, workspace: Workspace, input_data: dict, config: dict) -> StageResult:
        from sqlalchemy import create_engine, inspect, text

        db_url = input_data.get("db_url") or workspace._config.get("database", {}).get("url", "")

        # Handle file upload (CSV/Excel → SQLite)
        if input_data.get("file_path"):
            db_url = self._import_file(workspace, input_data["file_path"])

        try:
            engine = create_engine(db_url, connect_args=self._connect_args(db_url))
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))

            insp = inspect(engine)
            table_names = insp.get_table_names()

            # Count total rows
            total_rows = 0
            table_info = []
            with engine.connect() as conn:
                for t in table_names:
                    row = conn.execute(text(f'SELECT COUNT(*) FROM "{t}"')).fetchone()
                    cnt = row[0] if row else 0
                    total_rows += cnt
                    table_info.append({"name": t, "row_count": cnt})

            # Persist db_url to workspace.yaml
            workspace.save_config({"database": {"url": db_url}})

            db_type = db_url.split(":")[0].replace("+", " ")

            return StageResult(
                status="success",
                data={
                    "db_url": db_url,
                    "db_type": db_type,
                    "table_count": len(table_names),
                    "total_rows": total_rows,
                    "tables": table_info,
                },
                message=f"连接成功: {db_type}, {len(table_names)} 张表, {total_rows:,} 行数据",
            )
        except Exception as exc:
            return StageResult(
                status="failed",
                errors=[str(exc)],
                message=f"连接失败: {exc}",
            )

    def _connect_args(self, db_url: str) -> dict:
        if "sqlite" in db_url:
            return {"check_same_thread": False}
        return {}

    def _import_file(self, workspace: Workspace, file_path: str) -> str:
        """Import CSV/Excel into a workspace-local SQLite database."""
        import pandas as pd
        from pathlib import Path

        fp = Path(file_path)
        db_path = workspace.workspace_dir / "data.db"
        db_url = f"sqlite:///{db_path}"

        if fp.suffix.lower() == ".csv":
            df = pd.read_csv(fp)
        elif fp.suffix.lower() in (".xlsx", ".xls"):
            df = pd.read_excel(fp)
        else:
            raise ValueError(f"Unsupported file type: {fp.suffix}")

        table_name = fp.stem.lower().replace(" ", "_").replace("-", "_")
        from sqlalchemy import create_engine
        engine = create_engine(db_url)
        df.to_sql(table_name, engine, if_exists="replace", index=False)
        return db_url
