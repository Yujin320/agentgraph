import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  Card, Tabs, Table, Button, Input, Typography, Space, Tag, Badge,
  message, Row, Col, Statistic, Progress, Spin, Alert, Empty,
  Collapse, Divider,
} from 'antd';
import {
  CodeOutlined, PlayCircleOutlined, TableOutlined, FilterOutlined,
  DatabaseOutlined, SearchOutlined, SafetyOutlined, ReloadOutlined,
  DownOutlined,
} from '@ant-design/icons';
import api from '../api/client';
import DataTable from '../components/DataTable';

const { TextArea } = Input;
const { Text, Title } = Typography;

// ─── Types ────────────────────────────────────────────────────────────────────

type FieldCategory = 'identifier' | 'dimension' | 'measure' | 'time' | 'flag' | 'attribute' | 'other';

const FIELD_CATEGORY_LABELS: Record<FieldCategory, string> = {
  identifier: '标识符',
  dimension: '维度',
  measure: '指标',
  time: '时间',
  flag: '标识',
  attribute: '属性',
  other: '其他',
};

// v1 → v2 category mapping
const CATEGORY_REMAP: Record<string, FieldCategory> = {
  identifier: 'identifier',
  dimension: 'dimension',
  measure: 'measure',
  metadata: 'time',
  status: 'flag',
  reference: 'attribute',
  address: 'attribute',
  time: 'time',
  flag: 'flag',
  attribute: 'attribute',
  other: 'other',
};

const FIELD_CATEGORY_COLORS: Record<FieldCategory, string> = {
  identifier: 'purple',
  dimension: 'green',
  measure: 'blue',
  time: 'orange',
  flag: 'red',
  attribute: 'default',
  other: 'default',
};

function normalizeCategory(raw?: string): FieldCategory {
  if (!raw) return 'other';
  return CATEGORY_REMAP[raw] ?? 'other';
}

interface TableInfo {
  name: string;
  row_count: number;
  column_count: number;
  chinese_name?: string;
  description?: string;
}

interface FieldInfo {
  cid: number;
  name: string;
  type: string;
  pk: number;
  polished_name?: string;
  polished_description?: string;
  semantic_tags?: string[];
  category?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function annotationCoverage(fields: FieldInfo[]): number {
  if (!fields.length) return 0;
  const annotated = fields.filter(f => f.polished_name || f.polished_description).length;
  return Math.round((annotated / fields.length) * 100);
}

// ─── Overview Dashboard ───────────────────────────────────────────────────────

interface OverviewProps {
  tables: TableInfo[];
  allSchema: Record<string, FieldInfo[]>;
}

function OverviewDashboard({ tables, allSchema }: OverviewProps) {
  const totalFields = Object.values(allSchema).reduce((sum, f) => sum + f.length, 0);
  const totalAnnotated = Object.values(allSchema).reduce(
    (sum, f) => sum + f.filter(fi => fi.polished_name || fi.polished_description).length,
    0,
  );
  const totalRows = tables.reduce((sum, t) => sum + (t.row_count ?? 0), 0);
  const coveragePct = totalFields > 0 ? Math.round((totalAnnotated / totalFields) * 100) : 0;

  return (
    <Card style={{ marginBottom: 20, borderRadius: 12 }} styles={{ body: { padding: '20px 24px' } }}>
      <div style={{ marginBottom: 16 }}>
        <Text strong style={{ fontSize: 15 }}>Schema 概览</Text>
        <Text type="secondary" style={{ fontSize: 13, marginLeft: 8 }}>
          全量数据治理统计
        </Text>
      </div>
      <Row gutter={24} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Statistic
            title="数据表总数"
            value={tables.length}
            prefix={<TableOutlined />}
            valueStyle={{ color: 'var(--da-primary, #4338ca)' }}
          />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic
            title="字段总数"
            value={totalFields}
            prefix={<DatabaseOutlined />}
          />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic
            title="总行数"
            value={totalRows.toLocaleString()}
          />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic
            title="已标注字段"
            value={`${coveragePct}%`}
            valueStyle={{ color: coveragePct > 70 ? '#52c41a' : coveragePct > 40 ? '#faad14' : '#ff4d4f' }}
          />
        </Col>
      </Row>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>字段标注覆盖率（中文别名 + 业务描述）</Text>
          <Text style={{ fontSize: 12 }}>{totalAnnotated} / {totalFields}</Text>
        </div>
        <Progress
          percent={coveragePct}
          strokeColor={coveragePct > 70 ? '#52c41a' : coveragePct > 40 ? '#faad14' : '#ff4d4f'}
          trailColor="#f0f0f0"
          size={['100%', 12]}
        />
      </div>
    </Card>
  );
}

// ─── Table Card List ──────────────────────────────────────────────────────────

interface TableCardListProps {
  tables: TableInfo[];
  selected: string;
  schema: Record<string, FieldInfo[]>;
  onSelect: (name: string) => void;
}

function TableCardList({ tables, selected, schema, onSelect }: TableCardListProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {tables.map(t => {
        const isSelected = t.name === selected;
        const fields = schema[t.name] ?? [];
        const coverage = annotationCoverage(fields);
        return (
          <div
            key={t.name}
            onClick={() => onSelect(t.name)}
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              border: `1px solid ${isSelected ? 'var(--da-primary, #4338ca)' : '#e8e8e8'}`,
              background: isSelected ? '#eef2ff' : '#fafafa',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text strong style={{ fontSize: 13, color: isSelected ? 'var(--da-primary, #4338ca)' : undefined }}>
                {t.chinese_name || t.name}
              </Text>
              <Badge
                count={t.row_count.toLocaleString()}
                overflowCount={9999999}
                style={{ backgroundColor: isSelected ? 'var(--da-primary, #4338ca)' : '#8c8c8c', fontSize: 11 }}
              />
            </div>
            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>
              {t.name}
            </Text>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {t.column_count} 字段
              </Text>
              {fields.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Progress
                    percent={coverage}
                    showInfo={false}
                    size={[50, 4]}
                    strokeColor={coverage > 70 ? '#52c41a' : '#faad14'}
                  />
                  <Text type="secondary" style={{ fontSize: 10 }}>{coverage}%</Text>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Tab 1: Semantic Dictionary ───────────────────────────────────────────────

interface SemanticDictProps {
  fields: FieldInfo[];
  loading: boolean;
}

function SemanticDict({ fields, loading }: SemanticDictProps) {
  const [activeFilter, setActiveFilter] = useState<FieldCategory | null>(null);
  const [search, setSearch] = useState('');

  const categoryCounts = useMemo(() => {
    const counts: Partial<Record<FieldCategory, number>> = {};
    for (const f of fields) {
      const cat = normalizeCategory(f.category);
      counts[cat] = (counts[cat] ?? 0) + 1;
    }
    return counts;
  }, [fields]);

  const displayedFields = useMemo(() => {
    let result = fields;
    if (activeFilter) result = result.filter(f => normalizeCategory(f.category) === activeFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(f =>
        f.name.toLowerCase().includes(q) ||
        (f.polished_name ?? '').toLowerCase().includes(q) ||
        (f.polished_description ?? '').toLowerCase().includes(q),
      );
    }
    return result;
  }, [fields, activeFilter, search]);

  useEffect(() => { setActiveFilter(null); setSearch(''); }, [fields]);

  if (loading) return <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>;
  if (!fields.length) return <Empty description="暂无字段信息" />;

  const columns = [
    {
      title: '字段名',
      dataIndex: 'name',
      key: 'name',
      width: 160,
      render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 100,
      render: (v: string) => <Text type="secondary" style={{ fontSize: 12 }}>{v || '—'}</Text>,
    },
    {
      title: '分类',
      dataIndex: 'category',
      key: 'category',
      width: 90,
      render: (v: string) => {
        const cat = normalizeCategory(v);
        return (
          <Tag color={FIELD_CATEGORY_COLORS[cat]} style={{ fontSize: 11 }}>
            {FIELD_CATEGORY_LABELS[cat]}
          </Tag>
        );
      },
    },
    {
      title: '中文别名',
      dataIndex: 'polished_name',
      key: 'polished_name',
      width: 130,
      render: (v: string) => v
        ? <Text strong style={{ fontSize: 12 }}>{v}</Text>
        : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>,
    },
    {
      title: '业务描述',
      dataIndex: 'polished_description',
      key: 'polished_description',
      ellipsis: true,
      render: (v: string) => v
        ? <Text style={{ fontSize: 12 }}>{v}</Text>
        : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>,
    },
    {
      title: '语义标签',
      dataIndex: 'semantic_tags',
      key: 'semantic_tags',
      width: 160,
      render: (v: string[]) =>
        v?.length
          ? <Space wrap size={2}>{v.slice(0, 4).map(t => <Tag key={t} style={{ fontSize: 10, margin: 1 }}>{t}</Tag>)}</Space>
          : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>,
    },
  ];

  return (
    <div>
      {/* Filter bar */}
      <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <FilterOutlined style={{ color: '#8c8c8c', fontSize: 13 }} />
        {(Object.keys(FIELD_CATEGORY_LABELS) as FieldCategory[]).map(cat => {
          const cnt = categoryCounts[cat];
          if (!cnt) return null;
          const active = activeFilter === cat;
          return (
            <Tag
              key={cat}
              color={active ? FIELD_CATEGORY_COLORS[cat] : undefined}
              style={{
                cursor: 'pointer',
                border: active ? undefined : `1px solid ${FIELD_CATEGORY_COLORS[cat] === 'default' ? '#d9d9d9' : FIELD_CATEGORY_COLORS[cat]}`,
                color: active ? undefined : FIELD_CATEGORY_COLORS[cat] === 'default' ? '#8c8c8c' : FIELD_CATEGORY_COLORS[cat],
                background: active ? undefined : 'white',
              }}
              onClick={() => setActiveFilter(prev => prev === cat ? null : cat)}
            >
              {FIELD_CATEGORY_LABELS[cat]} ({cnt})
            </Tag>
          );
        })}
        {activeFilter && (
          <Text type="secondary" style={{ fontSize: 12, cursor: 'pointer' }} onClick={() => setActiveFilter(null)}>
            清除筛选
          </Text>
        )}
        <div style={{ flex: 1, maxWidth: 240, marginLeft: 'auto' }}>
          <Input
            size="small"
            prefix={<SearchOutlined style={{ color: '#bbb' }} />}
            placeholder="搜索字段名/别名..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            allowClear
          />
        </div>
      </div>

      <Table
        dataSource={displayedFields.map((f, i) => ({ ...f, key: f.cid ?? i }))}
        columns={columns}
        size="small"
        pagination={{ pageSize: 20, showTotal: t => `共 ${t} 个字段` }}
        scroll={{ x: 800 }}
      />
    </div>
  );
}

// ─── Tab 3: Data Quality ──────────────────────────────────────────────────────

interface QualityProps {
  workspace: string;
  tableName: string;
}

interface ColStat {
  column: string;
  null_count?: number;
  null_rate?: number;
  unique_count?: number;
  min?: number | string;
  max?: number | string;
  avg?: number;
  top_values?: { value: string; count: number }[];
}

function DataQuality({ workspace, tableName }: QualityProps) {
  const [stats, setStats] = useState<ColStat[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tableName) return;
    setLoading(true);
    setError(null);
    setStats(null);
    api.get(`/workspaces/${workspace}/pipeline/result/introspect`)
      .then(res => {
        // Extract column stats for the selected table
        const data = res.data;
        const tableData = data?.column_stats?.[tableName] ?? data?.tables?.[tableName]?.column_stats ?? null;
        if (tableData) {
          const arr: ColStat[] = Object.entries(tableData).map(([col, s]: [string, any]) => ({
            column: col,
            null_count: s.null_count,
            null_rate: s.null_rate,
            unique_count: s.unique_count,
            min: s.min,
            max: s.max,
            avg: s.avg,
            top_values: s.top_values,
          }));
          setStats(arr);
        } else {
          setStats([]);
        }
        setLoading(false);
      })
      .catch(() => {
        setError('质量数据暂不可用（需先完成 introspect 阶段）');
        setLoading(false);
      });
  }, [workspace, tableName]);

  if (loading) return <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>;
  if (error) return <Alert type="warning" message={error} showIcon />;
  if (!stats || stats.length === 0) return <Empty description="暂无质量数据，请先运行 introspect 阶段" />;

  const columns = [
    { title: '字段名', dataIndex: 'column', key: 'column', width: 140, render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text> },
    {
      title: 'NULL率',
      dataIndex: 'null_rate',
      key: 'null_rate',
      width: 100,
      render: (v: number, r: ColStat) => {
        const pct = v != null ? (v * 100).toFixed(1) + '%' : r.null_count != null ? r.null_count + '个' : '—';
        const color = v > 0.3 ? '#ff4d4f' : v > 0.1 ? '#faad14' : '#52c41a';
        return <Text style={{ color, fontSize: 12 }}>{pct}</Text>;
      },
    },
    { title: '唯一值数', dataIndex: 'unique_count', key: 'unique_count', width: 90, render: (v: number) => v != null ? v.toLocaleString() : '—' },
    { title: 'Min', dataIndex: 'min', key: 'min', width: 90, render: (v: any) => v != null ? String(v) : '—' },
    { title: 'Max', dataIndex: 'max', key: 'max', width: 90, render: (v: any) => v != null ? String(v) : '—' },
    { title: 'Avg', dataIndex: 'avg', key: 'avg', width: 90, render: (v: number) => v != null ? v.toFixed(2) : '—' },
    {
      title: 'Top Values',
      dataIndex: 'top_values',
      key: 'top_values',
      render: (v: { value: string; count: number }[]) =>
        v?.length
          ? <Space wrap size={2}>{v.slice(0, 5).map((tv, i) => <Tag key={i} style={{ fontSize: 10, margin: 1 }}>{tv.value} ({tv.count})</Tag>)}</Space>
          : '—',
    },
  ];

  return (
    <Table
      dataSource={stats.map((s, i) => ({ ...s, key: i }))}
      columns={columns}
      size="small"
      pagination={{ pageSize: 20 }}
      scroll={{ x: 700 }}
    />
  );
}

// ─── Tab 4: Custom Query ──────────────────────────────────────────────────────

interface CustomQueryProps {
  workspace: string;
  tableName: string;
}

function CustomQuery({ workspace, tableName }: CustomQueryProps) {
  const [sql, setSql] = useState('');
  const [result, setResult] = useState<{ columns: string[]; rows: any[][]; row_count?: number; error?: string } | null>(null);
  const [querying, setQuerying] = useState(false);

  useEffect(() => {
    if (tableName) setSql(`SELECT * FROM ${tableName} LIMIT 20`);
  }, [tableName]);

  const handleQuery = () => {
    const trimmed = sql.trim();
    if (!trimmed) return;
    if (!/^select\b/i.test(trimmed)) {
      message.warning('只允许执行 SELECT 查询');
      return;
    }
    setQuerying(true);
    setResult(null);
    api.post(`/explorer/${workspace}/query`, { sql: trimmed })
      .then(res => {
        setResult(res.data);
        if (res.data.error) message.error(res.data.error);
        setQuerying(false);
      })
      .catch(() => {
        message.error('查询失败，请检查 SQL 语法');
        setQuerying(false);
      });
  };

  return (
    <div>
      <Alert
        type="info"
        message="仅支持 SELECT 查询，结果最多返回 1000 行"
        showIcon
        style={{ marginBottom: 12, fontSize: 12 }}
      />
      <TextArea
        rows={5}
        value={sql}
        onChange={e => setSql(e.target.value)}
        placeholder="输入 SELECT 查询语句..."
        style={{ fontFamily: 'monospace', fontSize: 13, marginBottom: 12 }}
      />
      <Button
        type="primary"
        icon={<PlayCircleOutlined />}
        onClick={handleQuery}
        loading={querying}
        style={{ marginBottom: 16, background: 'var(--da-primary, #4338ca)', borderColor: 'var(--da-primary, #4338ca)' }}
      >
        执行查询
      </Button>

      {result?.error && (
        <Alert type="error" message={result.error} showIcon style={{ marginBottom: 12 }} />
      )}

      {result && !result.error && (
        <>
          <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
            返回 {result.row_count ?? result.rows?.length} 行
          </Text>
          <DataTable columns={result.columns} rows={result.rows} maxHeight={400} />
        </>
      )}
    </div>
  );
}

// ─── Business Rules Panel ─────────────────────────────────────────────────────

interface BusinessRulesProps {
  workspace: string;
  tableName: string;
}

function BusinessRulesPanel({ workspace, tableName }: BusinessRulesProps) {
  const [rules, setRules] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tableName) return;
    setLoading(true);
    api.get(`/workspaces/${workspace}/pipeline/result/enrich`)
      .then(res => {
        const data = res.data;
        const tableRules = data?.tables?.[tableName] ?? data?.[tableName] ?? null;
        setRules(tableRules);
        setLoading(false);
      })
      .catch(() => { setRules(null); setLoading(false); });
  }, [workspace, tableName]);

  const items = [
    {
      key: 'business_rules',
      label: (
        <Space>
          <SafetyOutlined />
          <span>业务规则与关系</span>
          {!loading && rules && <Tag color="blue" style={{ fontSize: 11 }}>来自 enrich 阶段</Tag>}
        </Space>
      ),
      children: loading
        ? <Spin size="small" />
        : rules
          ? (
            <div style={{ fontSize: 13 }}>
              {rules.business_rules?.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <Text strong style={{ display: 'block', marginBottom: 6 }}>业务规则</Text>
                  {rules.business_rules.map((r: string, i: number) => (
                    <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
                      <Text type="secondary" style={{ marginRight: 8 }}>•</Text>
                      <Text style={{ fontSize: 12 }}>{r}</Text>
                    </div>
                  ))}
                </div>
              )}
              {rules.relationships?.length > 0 && (
                <div>
                  <Text strong style={{ display: 'block', marginBottom: 6 }}>表间关系</Text>
                  {rules.relationships.map((rel: any, i: number) => (
                    <Tag key={i} style={{ marginBottom: 4 }}>
                      {typeof rel === 'string' ? rel : `${rel.table} → ${rel.column}`}
                    </Tag>
                  ))}
                </div>
              )}
              {!rules.business_rules?.length && !rules.relationships?.length && (
                <pre style={{ fontSize: 11, maxHeight: 200, overflow: 'auto', background: '#f5f5f5', padding: 12, borderRadius: 4 }}>
                  {JSON.stringify(rules, null, 2)}
                </pre>
              )}
            </div>
          )
          : <Text type="secondary" style={{ fontSize: 12 }}>暂无业务规则数据（需先完成 enrich 阶段）</Text>,
    },
  ];

  return (
    <Collapse
      items={items}
      ghost
      expandIcon={({ isActive }) => <DownOutlined rotate={isActive ? 180 : 0} />}
      style={{ marginTop: 16, border: '1px solid #f0f0f0', borderRadius: 8, background: '#fafafa' }}
    />
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DataGovernance() {
  const { workspace } = useParams<{ workspace: string }>();
  const ws = workspace ?? '';

  const [tables, setTables] = useState<TableInfo[]>([]);
  const [tablesLoading, setTablesLoading] = useState(true);
  const [tablesError, setTablesError] = useState<string | null>(null);
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [schema, setSchema] = useState<Record<string, FieldInfo[]>>({});
  const [currentSchema, setCurrentSchema] = useState<FieldInfo[]>([]);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [previewData, setPreviewData] = useState<{ columns: string[]; rows: any[][] } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('semantic');

  const fetchTables = useCallback(() => {
    setTablesLoading(true);
    setTablesError(null);
    api.get(`/explorer/${ws}/tables`)
      .then(res => {
        setTables(res.data);
        if (res.data.length > 0 && !selectedTable) setSelectedTable(res.data[0].name);
        setTablesLoading(false);
      })
      .catch(() => {
        setTablesError('加载数据表失败');
        setTablesLoading(false);
      });
  }, [ws, selectedTable]);

  useEffect(() => { fetchTables(); }, [ws]);

  useEffect(() => {
    if (!selectedTable) return;
    setSchemaLoading(true);
    setPreviewLoading(true);
    setCurrentSchema([]);
    setPreviewData(null);

    api.get(`/explorer/${ws}/tables/${selectedTable}/schema`)
      .then(res => {
        const fields: FieldInfo[] = res.data;
        setCurrentSchema(fields);
        setSchema(prev => ({ ...prev, [selectedTable]: fields }));
        setSchemaLoading(false);
      })
      .catch(() => setSchemaLoading(false));

    api.get(`/explorer/${ws}/tables/${selectedTable}/data?limit=50`)
      .then(res => { setPreviewData(res.data); setPreviewLoading(false); })
      .catch(() => setPreviewLoading(false));
  }, [ws, selectedTable]);

  const selectedTableInfo = tables.find(t => t.name === selectedTable);

  return (
    <div style={{ maxWidth: 1500, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          <DatabaseOutlined style={{ color: 'var(--da-primary, #4338ca)', marginRight: 8 }} />
          数据治理
        </Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          语义字典 · 数据预览 · 数据质量 · 自定义查询
        </Text>
      </div>

      {/* Overview */}
      <OverviewDashboard tables={tables} allSchema={schema} />

      {tablesError && (
        <Alert
          type="error"
          message={tablesError}
          showIcon
          action={<Button size="small" onClick={fetchTables} icon={<ReloadOutlined />}>重试</Button>}
          style={{ marginBottom: 16 }}
        />
      )}

      <Row gutter={16} style={{ alignItems: 'flex-start' }}>
        {/* Left: table list */}
        <Col xs={24} md={7} lg={6}>
          <Card
            title={
              <Space>
                <TableOutlined />
                <span>数据表列表</span>
                <Tag color="geekblue" style={{ fontSize: 11 }}>{tables.length} 张</Tag>
              </Space>
            }
            size="small"
            loading={tablesLoading}
            extra={<Button size="small" icon={<ReloadOutlined />} type="text" onClick={fetchTables} />}
            styles={{ body: { padding: '12px', maxHeight: '80vh', overflowY: 'auto' } }}
          >
            {!tablesLoading && tables.length === 0 && (
              <Empty description="暂无数据表" />
            )}
            <TableCardList
              tables={tables}
              selected={selectedTable}
              schema={schema}
              onSelect={t => { setSelectedTable(t); setActiveTab('semantic'); }}
            />
          </Card>
        </Col>

        {/* Right: detail */}
        <Col xs={24} md={17} lg={18}>
          {selectedTable ? (
            <Card
              title={
                <Space wrap>
                  <Text strong style={{ fontSize: 15 }}>
                    {selectedTableInfo?.chinese_name || selectedTable}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 13 }}>{selectedTable}</Text>
                  {selectedTableInfo && (
                    <Tag color="blue">{selectedTableInfo.row_count.toLocaleString()} 行</Tag>
                  )}
                  {selectedTableInfo && (
                    <Tag color="geekblue">{selectedTableInfo.column_count} 字段</Tag>
                  )}
                  {currentSchema.length > 0 && (
                    <Tag color={annotationCoverage(currentSchema) > 70 ? 'green' : 'orange'}>
                      标注 {annotationCoverage(currentSchema)}%
                    </Tag>
                  )}
                </Space>
              }
              size="small"
            >
              <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                items={[
                  {
                    key: 'semantic',
                    label: '语义字典',
                    children: <SemanticDict fields={currentSchema} loading={schemaLoading} />,
                  },
                  {
                    key: 'preview',
                    label: '数据预览',
                    children: (
                      <div>
                        {previewLoading
                          ? <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
                          : previewData
                            ? (
                              <>
                                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                                  显示前 50 行，共 {selectedTableInfo?.row_count?.toLocaleString() ?? '—'} 行
                                </Text>
                                <DataTable columns={previewData.columns} rows={previewData.rows} maxHeight={500} />
                              </>
                            )
                            : <Empty description="暂无预览数据" />
                        }
                      </div>
                    ),
                  },
                  {
                    key: 'quality',
                    label: '数据质量',
                    children: <DataQuality workspace={ws} tableName={selectedTable} />,
                  },
                  {
                    key: 'query',
                    label: (
                      <span>
                        <CodeOutlined /> 自定义查询
                      </span>
                    ),
                    children: <CustomQuery workspace={ws} tableName={selectedTable} />,
                  },
                ]}
              />

              <Divider style={{ margin: '8px 0' }} />
              <BusinessRulesPanel workspace={ws} tableName={selectedTable} />
            </Card>
          ) : (
            <Card>
              <Empty description="请从左侧选择一张数据表" />
            </Card>
          )}
        </Col>
      </Row>
    </div>
  );
}
