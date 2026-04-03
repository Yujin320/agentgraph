"""All LLM prompts for the agentic reasoning engine."""

INTENT_PROMPT = """\
你是智能数据分析助手。请分析用户问题的意图，并分类到以下策略之一：
- causal: 归因分析（为什么、原因、根因、怎么回事）
- statistical: 统计分析（相关性、分布、占比、TOP N）
- comparative: 对比分析（对比、比较、同比、环比、差异）
- trend: 趋势分析（趋势、走势、变化、历史）
- whatif: 假设分析（如果、假设、模拟、预测）
- general: 一般查询（其他所有问题）

用户问题: {question}

请返回严格JSON格式（不要markdown代码块）：
{{"intent": "问题意图的简要描述", "strategy": "策略名称"}}
"""

PLAN_PROMPT = """\
你是数据分析规划专家。根据用户问题和分析策略，将分析任务分解为有序的子步骤列表。

用户问题: {question}
分析策略: {strategy}
意图: {intent}

{context}

要求：
- 每个步骤用简短的中文描述（10-20字）
- 步骤数量2-5个，不要过多
- 如果是简单查询，只需要"生成SQL"、"执行查询"、"解读结果"三步
- 如果是归因分析，需要"定位入口指标"、"遍历因果路径"、"验证各节点"、"综合结论"

请返回严格JSON格式（不要markdown代码块）：
{{"steps": ["步骤1", "步骤2", ...]}}
"""

SQL_GEN_PROMPT = """\
你是数据分析SQL专家。根据用户问题和数据库schema生成SQLite查询。

{schema_context}

{few_shots}

当前报告期: {current_period}

分析计划上下文:
- 当前步骤: {current_step}
- 分析意图: {intent}

用户问题: {question}

要求：
- 只返回SQL，不要解释
- 使用schema中的实际列名
- 数值结果用ROUND()保留2位小数
- 排除退货记录（deliv_retrngds_identfctn IS NULL）
- 日期过滤使用正确的函数（见schema说明）

生成一条SQLite查询语句:"""

RETRY_PROMPT = """\
上一次SQL执行失败，错误信息：
{error}

之前生成的SQL：
{failed_sql}

请根据错误信息修正SQL。注意：
- 检查列名是否与schema匹配
- 检查表名是否正确
- 检查SQL语法是否正确
- 只返回修正后的SQL，不要解释

{schema_context}

用户问题: {question}

修正后的SQL:"""

REFLECT_PROMPT = """\
你是数据分析专家。请评估以下SQL查询结果的质量，并决定下一步操作。

用户问题: {question}
分析策略: {strategy}
当前步骤: {current_step} / {total_steps}

执行的SQL:
{sql}

查询结果:
列: {columns}
数据（前10行）: {rows}
总行数: {row_count}

请评估并返回严格JSON格式（不要markdown代码块）：
{{
  "quality": "good" | "partial" | "bad",
  "assessment": "对结果质量的简要评价",
  "decision": "conclude" | "drill" | "retry",
  "reason": "决策理由"
}}

决策说明：
- conclude: 结果足够好，可以生成最终结论
- drill: 需要更深入的分析（仅当策略需要多步分析时）
- retry: 结果有问题，需要重新生成SQL（仅当有明显错误时）"""

CONCLUDE_PROMPT = """\
你是供应链数据分析顾问。请根据所有分析步骤的结果，生成最终的分析结论。

用户问题: {question}
分析策略: {strategy}

分析过程:
{reasoning_trace}

要求：
- 用简洁的中文业务语言
- 凸显关键发现和异常值
- 给出可落地的建议
- 200字以内
- 不要使用Markdown格式"""

CHART_SELECT_PROMPT = """\
根据以下查询结果，选择最适合的图表类型。

查询结果列: {columns}
数据行数: {row_count}
分析策略: {strategy}
用户问题: {question}

请返回严格JSON格式（不要markdown代码块）：
{{
  "type": "bar" | "line" | "pie" | "table" | "kpi",
  "x_column": "X轴列名或null",
  "y_columns": ["Y轴列名列表"],
  "title": "图表标题"
}}"""
