import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import {
  Card, Tabs, Button, Input, Typography, Space, Tag, Badge,
  message, Row, Col, Spin, Alert, Empty,
} from 'antd';
import {
  CodeOutlined, PlayCircleOutlined, TableOutlined,
  FilterOutlined, DatabaseOutlined, SearchOutlined,
} from '@ant-design/icons';
import api from '../api/client';
import DataTable from '../components/DataTable';
import { useTheme } from '../contexts/ThemeContext';

const { TextArea } = Input;
const { Text, Title } = Typography;

// ──────────────────────────────────────────────────────────────────────────────
// Field category config
// ──────────────────────────────────────────────────────────────────────────────

type FieldCategory =
  | 'identifier'
  | 'dimension'
  | 'measure'
  | 'time'
  | 'flag'
  | 'attribute'
  | 'other';

const FIELD_CATEGORY_LABELS: Record<FieldCategory, string> = {
  identifier: '标识符',
  dimension: '维度',
  measure: '指标',
  time: '时间',
  flag: '状态/标识',
  attribute: '属性',
  other: '其他',
};

const FIELD_CATEGORY_COLORS: Record<FieldCategory, string> = {
  identifier: 'red',
  dimension: 'blue',
  measure: 'green',
  time: 'purple',
  flag: 'orange',
  attribute: 'geekblue',
  other: 'default',
};

// Map API category strings to our FieldCategory enum
const CATEGORY_ALIAS_MAP: Record<string, FieldCategory> = {
  identifier: 'identifier',
  dimension: 'dimension',
  measure: 'measure',
  metadata: 'time',
  time: 'time',
  status: 'flag',
  flag: 'flag',
  reference: 'attribute',
  address: 'attribute',
  attribute: 'attribute',
};

function inferFieldCategory(
  fieldName: string,
  isPk: boolean,
  type: string,
  apiCategory?: string,
): FieldCategory {
  if (apiCategory) {
    const mapped = CATEGORY_ALIAS_MAP[apiCategory.toLowerCase()];
    if (mapped) return mapped;
  }
  if (isPk) return 'identifier';
  const n = fieldName.toLowerCase();
  if (/qty|amt|amount|pct|rate|cost|price|planqty|count|sum/.test(n)) return 'measure';
  if (/time|date|yearmth|_mth|_dt|_at$/.test(n)) return 'time';
  if (/_sts|_status|identfctn|is_|_flag/.test(n)) return 'flag';
  if (/_code|_num|num$|id$/.test(n)) return 'identifier';
  if (/_name|_descrptn|_chnl|_type/.test(n)) return 'dimension';
  if (type?.toUpperCase().includes('FLOAT') || type?.toUpperCase().includes('REAL')) return 'measure';
  return 'other';
}

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

interface TableInfo {
  name: string;
  display_name?: string;
  description?: string;
  row_count?: number;
  column_count?: number;
}

interface FieldInfo {
  cid?: number;
  name: string;
  type: string;
  pk?: number;
  notnull?: number;
  polished_name?: string;
  polished_description?: string;
  chinese_name?: string;
  description?: string;
  semantic_tags?: string[];
  category?: string;
  importance?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Left panel: table card list
// ──────────────────────────────────────────────────────────────────────────────

interface TableCardListProps {
  tables: TableInfo[];
  selected: string;
  onSelect: (name: string) => void;
  loading: boolean;
  searchText: string;
}

function TableCardList({ tables, selected, onSelect, loading, searchText }: TableCardListProps) {
  const { colors } = useTheme();
  const filtered = tables.filter((t) => {
    if (!searchText) return true;
    const q = searchText.toLowerCase();
    return (
      t.name.toLowerCase().includes(q) ||
      (t.display_name ?? '').toLowerCase().includes(q) ||
      (t.description ?? '').toLowerCase().includes(q)
    );
  });

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0' }}>
        <Spin size="small" />
      </div>
    );
  }

  if (filtered.length === 0) {
    return <Empty description="暂无数据表" style={{ padding: '24px 0' }} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {filtered.map((t) => {
        const isSelected = t.name === selected;
        const displayName = t.display_name ?? t.name;
        return (
          <div
            key={t.name}
            onClick={() => onSelect(t.name)}
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              border: `1px solid ${isSelected ? colors.primary : colors.borderBase}`,
              background: isSelected ? colors.primarySubtle : colors.bgMuted,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => {
              if (!isSelected)
                (e.currentTarget as HTMLElement).style.borderColor = colors.primary;
            }}
            onMouseLeave={(e) => {
              if (!isSelected)
                (e.currentTarget as HTMLElement).style.borderColor = colors.borderBase;
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text strong style={{ fontSize: 13, color: isSelected ? colors.primary : undefined }}>
                {displayName}
              </Text>
              {t.row_count !== undefined && (
                <Badge
                  count={t.row_count.toLocaleString()}
                  overflowCount={9999999}
                  style={{ backgroundColor: isSelected ? colors.primary : '#8c8c8c', fontSize: 11 }}
                />
              )}
            </div>
            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>
              {t.name}
            </Text>
            {t.description && (
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                {t.description}
              </Text>
            )}
            {t.column_count !== undefined && (
              <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                {t.column_count} 字段
              </Text>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Schema field list (字段语义 tab)
// ──────────────────────────────────────────────────────────────────────────────

function SchemaFieldList({ fields }: { fields: FieldInfo[] }) {
  const { colors } = useTheme();
  const [activeFilter, setActiveFilter] = useState<FieldCategory | null>(null);
  const [searchText, setSearchText] = useState('');

  // Compute category counts
  const categoryCounts = useMemo(() => {
    const counts: Partial<Record<FieldCategory, number>> = {};
    for (const f of fields) {
      const cat = inferFieldCategory(f.name, f.pk === 1, f.type, f.category);
      counts[cat] = (counts[cat] ?? 0) + 1;
    }
    return counts;
  }, [fields]);

  const displayedFields = useMemo(() => {
    let result = fields;
    if (activeFilter) {
      result = result.filter(
        (f) => inferFieldCategory(f.name, f.pk === 1, f.type, f.category) === activeFilter,
      );
    }
    if (searchText) {
      const q = searchText.toLowerCase();
      result = result.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          (f.polished_name ?? f.chinese_name ?? '').toLowerCase().includes(q) ||
          (f.polished_description ?? f.description ?? '').toLowerCase().includes(q) ||
          (f.semantic_tags ?? []).some((t) => t.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [fields, activeFilter, searchText]);

  // Reset filter when table changes
  useEffect(() => {
    setActiveFilter(null);
    setSearchText('');
  }, [fields]);

  if (fields.length === 0) {
    return <Empty description="暂无字段信息" style={{ padding: 40 }} />;
  }

  return (
    <div>
      {/* Filter bar */}
      <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <FilterOutlined style={{ color: '#8c8c8c', fontSize: 13 }} />
        {(Object.keys(FIELD_CATEGORY_LABELS) as FieldCategory[]).map((cat) => {
          const cnt = categoryCounts[cat];
          if (!cnt) return null;
          const active = activeFilter === cat;
          return (
            <Tag
              key={cat}
              color={active ? FIELD_CATEGORY_COLORS[cat] : undefined}
              style={{
                cursor: 'pointer',
                border: active
                  ? undefined
                  : `1px solid ${
                      FIELD_CATEGORY_COLORS[cat] === 'default' ? '#d9d9d9' : FIELD_CATEGORY_COLORS[cat]
                    }`,
                color:
                  active
                    ? undefined
                    : FIELD_CATEGORY_COLORS[cat] === 'default'
                    ? '#8c8c8c'
                    : FIELD_CATEGORY_COLORS[cat],
                background: active ? undefined : 'white',
              }}
              onClick={() => setActiveFilter((prev) => (prev === cat ? null : cat))}
            >
              {FIELD_CATEGORY_LABELS[cat]} ({cnt})
            </Tag>
          );
        })}
        {activeFilter && (
          <Text
            type="secondary"
            style={{ fontSize: 12, cursor: 'pointer' }}
            onClick={() => setActiveFilter(null)}
          >
            清除筛选
          </Text>
        )}
        <Input
          prefix={<SearchOutlined style={{ color: '#94A3B8' }} />}
          placeholder="搜索字段名或描述"
          size="small"
          allowClear
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{ width: 220, marginLeft: 'auto' }}
        />
      </div>

      {/* Field rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {displayedFields.map((f, idx) => {
          const cat = inferFieldCategory(f.name, f.pk === 1, f.type, f.category);
          const chineseName = f.polished_name ?? f.chinese_name ?? '';
          const description = f.polished_description ?? f.description ?? '';
          return (
            <div
              key={f.cid ?? idx}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '8px 12px',
                borderRadius: 6,
                border: `1px solid ${colors.borderSubtle}`,
                background: colors.bgMuted,
              }}
            >
              {/* Category tag */}
              <Tag
                color={FIELD_CATEGORY_COLORS[cat]}
                style={{ fontSize: 11, marginRight: 0, flexShrink: 0, marginTop: 1 }}
              >
                {FIELD_CATEGORY_LABELS[cat]}
              </Tag>

              {/* Field name + type */}
              <div style={{ flex: '0 0 auto', minWidth: 150 }}>
                <Text code style={{ fontSize: 12 }}>{f.name}</Text>
                {chineseName && (
                  <Text strong style={{ fontSize: 12, marginLeft: 6, color: colors.primary }}>
                    {chineseName}
                  </Text>
                )}
                {f.pk === 1 && (
                  <Tag color="red" style={{ fontSize: 10, marginLeft: 4, padding: '0 4px' }}>
                    PK
                  </Tag>
                )}
                <br />
                <Text type="secondary" style={{ fontSize: 11 }}>{f.type || '—'}</Text>
                {f.importance && (
                  <Tag
                    style={{ fontSize: 10, marginLeft: 4, padding: '0 4px' }}
                    color={f.importance === 'high' ? 'orange' : 'default'}
                  >
                    {f.importance}
                  </Tag>
                )}
              </div>

              {/* Description */}
              <Text type="secondary" style={{ fontSize: 12, flex: 1, lineHeight: 1.6 }}>
                {description || '—'}
              </Text>

              {/* Semantic tags */}
              {(f.semantic_tags ?? []).length > 0 && (
                <div style={{ flexShrink: 0 }}>
                  {(f.semantic_tags ?? []).slice(0, 4).map((t: string) => (
                    <Tag
                      key={t}
                      style={{
                        fontSize: 10,
                        marginBottom: 2,
                        background: '#EEF2FF',
                        color: '#4338CA',
                        borderColor: '#C7D2FE',
                      }}
                    >
                      {t}
                    </Tag>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {displayedFields.length === 0 && (
          <Text type="secondary" style={{ fontSize: 13, padding: '12px 0' }}>
            暂无匹配字段
          </Text>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Main page
// ──────────────────────────────────────────────────────────────────────────────

export default function DataBrowser() {
  const { workspace = '' } = useParams<{ workspace: string }>();
  const { colors } = useTheme();

  // Tables
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [tablesLoading, setTablesLoading] = useState(true);
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [tableSearch, setTableSearch] = useState('');

  // Schema
  const [schema, setSchema] = useState<FieldInfo[]>([]);
  const [schemaLoading, setSchemaLoading] = useState(false);

  // Data preview
  const [previewData, setPreviewData] = useState<{ columns: string[]; rows: unknown[][] } | null>(
    null,
  );
  const [previewLoading, setPreviewLoading] = useState(false);

  // Custom SQL query
  const [sql, setSql] = useState('SELECT * FROM <table_name> LIMIT 20');
  const [queryResult, setQueryResult] = useState<{
    columns: string[];
    rows: unknown[][];
    row_count?: number;
    error?: string;
  } | null>(null);
  const [querying, setQuerying] = useState(false);
  const [sqlError, setSqlError] = useState<string | null>(null);

  // Load tables on workspace change
  useEffect(() => {
    if (!workspace) return;
    setTablesLoading(true);
    api
      .get(`/explorer/${workspace}/tables`)
      .then((res) => {
        const data: TableInfo[] = Array.isArray(res.data) ? res.data : [];
        setTables(data);
        if (data.length > 0) {
          setSelectedTable(data[0].name);
          setSql(`SELECT * FROM ${data[0].name} LIMIT 20`);
        }
      })
      .catch(() => setTables([]))
      .finally(() => setTablesLoading(false));
  }, [workspace]);

  // Load schema + preview when table changes
  useEffect(() => {
    if (!selectedTable || !workspace) return;
    setSchemaLoading(true);
    setPreviewLoading(true);
    setSchema([]);
    setPreviewData(null);

    api
      .get(`/explorer/${workspace}/tables/${selectedTable}/schema`)
      .then((res) => {
        const data = Array.isArray(res.data) ? res.data : [];
        setSchema(data);
      })
      .catch(() => setSchema([]))
      .finally(() => setSchemaLoading(false));

    api
      .get(`/explorer/${workspace}/tables/${selectedTable}/data`, { params: { limit: 50 } })
      .then((res) => setPreviewData(res.data))
      .catch(() => setPreviewData(null))
      .finally(() => setPreviewLoading(false));
  }, [selectedTable, workspace]);

  const handleTableSelect = (name: string) => {
    setSelectedTable(name);
    setSql(`SELECT * FROM ${name} LIMIT 20`);
    setQueryResult(null);
    setSqlError(null);
  };

  const validateSql = (query: string): string | null => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return '请输入 SQL 查询语句';
    if (!trimmed.startsWith('select')) return '仅允许 SELECT 查询语句（以 SELECT 开头）';
    if (/\b(drop|delete|truncate|insert|update|alter|create)\b/.test(trimmed)) {
      return '不允许执行数据修改操作（DROP / DELETE / UPDATE 等）';
    }
    return null;
  };

  const handleQuery = () => {
    const validationError = validateSql(sql);
    if (validationError) {
      setSqlError(validationError);
      return;
    }
    setSqlError(null);
    setQuerying(true);
    setQueryResult(null);

    api
      .post(`/explorer/${workspace}/query`, { sql: sql.trim() })
      .then((res) => {
        setQueryResult(res.data);
        if (res.data.error) {
          message.error(res.data.error);
        }
      })
      .catch((err: { response?: { data?: { detail?: string } } }) => {
        const detail = err?.response?.data?.detail ?? '查询失败，请检查 SQL 语法';
        setSqlError(detail);
        message.error(detail);
      })
      .finally(() => setQuerying(false));
  };

  const selectedTableInfo = tables.find((t) => t.name === selectedTable);

  return (
    <div style={{ maxWidth: 1440, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <Title level={4} style={{ marginBottom: 4 }}>
          <DatabaseOutlined style={{ marginRight: 8, color: colors.primary }} />
          数据浏览器
        </Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          工作空间 {workspace} · 只读数据探索，支持字段语义查看、数据预览与自定义 SELECT 查询
        </Text>
      </div>

      <Row gutter={16} style={{ alignItems: 'flex-start' }}>
        {/* ── Left panel: table list ── */}
        <Col xs={24} md={7} lg={6}>
          <Card
            title={
              <Space>
                <TableOutlined style={{ color: colors.primary }} />
                数据表列表
                <Badge
                  count={tables.length}
                  style={{ backgroundColor: colors.primary }}
                />
              </Space>
            }
            size="small"
            styles={{ body: { padding: '12px' } }}
            style={{ position: 'sticky', top: 16 }}
          >
            <Input
              prefix={<SearchOutlined style={{ color: '#94A3B8' }} />}
              placeholder="搜索表名或描述…"
              size="small"
              allowClear
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              style={{ marginBottom: 10 }}
            />
            <TableCardList
              tables={tables}
              selected={selectedTable}
              onSelect={handleTableSelect}
              loading={tablesLoading}
              searchText={tableSearch}
            />
          </Card>
        </Col>

        {/* ── Right panel: detail ── */}
        <Col xs={24} md={17} lg={18}>
          {selectedTable ? (
            <Card
              title={
                <Space wrap>
                  <Text strong style={{ fontSize: 15 }}>
                    {selectedTableInfo?.display_name ?? selectedTable}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    {selectedTable}
                  </Text>
                  {selectedTableInfo?.row_count !== undefined && (
                    <Tag color="blue">
                      {selectedTableInfo.row_count.toLocaleString()} 行
                    </Tag>
                  )}
                  {selectedTableInfo?.column_count !== undefined && (
                    <Tag color="geekblue">{selectedTableInfo.column_count} 字段</Tag>
                  )}
                </Space>
              }
              size="small"
            >
              <Tabs
                defaultActiveKey="schema"
                items={[
                  {
                    key: 'schema',
                    label: '字段语义',
                    children: (
                      <div>
                        {schemaLoading ? (
                          <div style={{ textAlign: 'center', padding: '40px 0' }}>
                            <Spin />
                          </div>
                        ) : (
                          <SchemaFieldList fields={schema} />
                        )}
                      </div>
                    ),
                  },
                  {
                    key: 'preview',
                    label: '数据预览',
                    children: (
                      <div>
                        {previewLoading ? (
                          <div style={{ textAlign: 'center', padding: '40px 0' }}>
                            <Spin />
                          </div>
                        ) : previewData ? (
                          <>
                            <Text
                              type="secondary"
                              style={{ fontSize: 12, display: 'block', marginBottom: 10 }}
                            >
                              显示前 50 行（只读）
                            </Text>
                            <DataTable
                              columns={previewData.columns}
                              rows={previewData.rows}
                              maxHeight={500}
                            />
                          </>
                        ) : (
                          <Empty description="无预览数据" style={{ padding: 40 }} />
                        )}
                      </div>
                    ),
                  },
                  {
                    key: 'query',
                    label: (
                      <>
                        <CodeOutlined /> 自定义查询
                      </>
                    ),
                    children: (
                      <div>
                        <Alert
                          type="info"
                          message="只读模式：仅允许 SELECT 查询，禁止 INSERT / UPDATE / DELETE / DROP 等写操作"
                          showIcon
                          style={{ marginBottom: 12, fontSize: 12 }}
                        />
                        <TextArea
                          rows={5}
                          value={sql}
                          onChange={(e) => {
                            setSql(e.target.value);
                            setSqlError(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && e.ctrlKey) {
                              e.preventDefault();
                              handleQuery();
                            }
                          }}
                          placeholder={`SELECT * FROM ${selectedTable} LIMIT 20`}
                          style={{
                            fontFamily: '"JetBrains Mono","Fira Code",monospace',
                            fontSize: 13,
                            marginBottom: 4,
                          }}
                        />
                        {sqlError && (
                          <Text
                            type="danger"
                            style={{ display: 'block', marginBottom: 8, fontSize: 12 }}
                          >
                            {sqlError}
                          </Text>
                        )}
                        <Space style={{ marginBottom: 16 }}>
                          <Button
                            type="primary"
                            icon={<PlayCircleOutlined />}
                            onClick={handleQuery}
                            loading={querying}
                            style={{ background: colors.primary, borderColor: colors.primary }}
                          >
                            执行查询
                          </Button>
                          <Button
                            onClick={() => {
                              setSql(`SELECT * FROM ${selectedTable} LIMIT 20`);
                              setSqlError(null);
                              setQueryResult(null);
                            }}
                          >
                            重置
                          </Button>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            Ctrl+Enter 快速执行
                          </Text>
                        </Space>

                        {queryResult?.error && (
                          <Alert
                            type="error"
                            message={queryResult.error}
                            showIcon
                            style={{ marginBottom: 12 }}
                          />
                        )}

                        {queryResult && !queryResult.error && (
                          <>
                            <div
                              style={{
                                marginBottom: 8,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                              }}
                            >
                              <Text strong style={{ fontSize: 13 }}>
                                查询结果
                              </Text>
                              <Tag color="green">
                                {queryResult.row_count ?? queryResult.rows.length} 行
                              </Tag>
                              <Tag>{queryResult.columns.length} 列</Tag>
                            </div>
                            <DataTable
                              columns={queryResult.columns}
                              rows={queryResult.rows}
                              maxHeight={400}
                            />
                          </>
                        )}
                      </div>
                    ),
                  },
                ]}
              />
            </Card>
          ) : (
            <Card>
              <Empty description="请从左侧选择一张数据表" style={{ padding: 40 }} />
            </Card>
          )}
        </Col>
      </Row>
    </div>
  );
}
