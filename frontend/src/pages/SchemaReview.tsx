import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Tabs,
  Table,
  Button,
  Input,
  Spin,
  Alert,
  Typography,
  Card,
  message,
  Space,
} from 'antd';
import { pipelineApi } from '../api/client';

const { Title, Text } = Typography;

interface FieldRow {
  key: string;
  field_name: string;
  type: string;
  alias: string;
  description: string;
}

interface TableData {
  [tableName: string]: {
    fields?: Record<string, { type?: string; alias?: string; description?: string }>;
    columns?: Record<string, { type?: string; alias?: string; description?: string }>;
  };
}

const SchemaReview: React.FC = () => {
  const { workspace } = useParams<{ workspace: string }>();
  const navigate = useNavigate();
  const ws = workspace ?? '';

  const [rawData, setRawData] = useState<TableData>({});
  const [tableRows, setTableRows] = useState<Record<string, FieldRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchResult = useCallback(async () => {
    try {
      const res = await pipelineApi.getResult(ws, 'enrich');
      const data = (res.data?.data ?? res.data) as TableData;
      setRawData(data);

      // Build editable rows per table
      const rows: Record<string, FieldRow[]> = {};
      for (const [tbl, tblData] of Object.entries(data)) {
        const fields = tblData.fields ?? tblData.columns ?? {};
        rows[tbl] = Object.entries(fields).map(([colName, colMeta]) => ({
          key: colName,
          field_name: colName,
          type: colMeta?.type ?? '',
          alias: colMeta?.alias ?? '',
          description: colMeta?.description ?? '',
        }));
      }
      setTableRows(rows);
      setError(null);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        (err as Error)?.message ??
        '加载失败';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [ws]);

  useEffect(() => {
    fetchResult();
  }, [fetchResult]);

  const handleCellEdit = (
    tableName: string,
    rowKey: string,
    field: 'alias' | 'description',
    value: string,
  ) => {
    setTableRows((prev) => ({
      ...prev,
      [tableName]: prev[tableName].map((row) =>
        row.key === rowKey ? { ...row, [field]: value } : row,
      ),
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Reconstruct the data structure with edits merged back in
      const updated: TableData = {};
      for (const [tbl, rows] of Object.entries(tableRows)) {
        const originalFields = rawData[tbl]?.fields ?? rawData[tbl]?.columns ?? {};
        const updatedFields: Record<string, { type?: string; alias?: string; description?: string }> = {};
        for (const row of rows) {
          updatedFields[row.field_name] = {
            ...(originalFields[row.field_name] ?? {}),
            type: row.type,
            alias: row.alias,
            description: row.description,
          };
        }
        updated[tbl] = { ...rawData[tbl], fields: updatedFields };
      }

      await pipelineApi.submitReview(ws, 'enrich', updated);
      message.success('Schema 审核已提交，流程继续执行');
      navigate(`/w/${ws}/setup`);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        (err as Error)?.message ??
        '保存失败';
      message.error(`保存失败：${msg}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 48 }}>
        <Alert type="error" message="加载失败" description={error} showIcon />
      </div>
    );
  }

  const tableNames = Object.keys(tableRows);

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5', padding: '48px 24px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <Title level={2} style={{ margin: 0 }}>
            语义标注审核
          </Title>
          <Text style={{ color: '#888' }}>
            工作空间：<Text strong>{ws}</Text> — 检查并编辑字段别名和描述，然后保存继续。
          </Text>
        </div>

        <Card style={{ borderRadius: 12 }}>
          {tableNames.length === 0 ? (
            <Alert type="info" message="暂无表结构数据" showIcon />
          ) : (
            <Tabs
              type="card"
              items={tableNames.map((tbl) => ({
                key: tbl,
                label: tbl,
                children: (
                  <Table<FieldRow>
                    dataSource={tableRows[tbl]}
                    rowKey="key"
                    pagination={false}
                    size="small"
                    bordered
                    columns={[
                      {
                        title: '字段名',
                        dataIndex: 'field_name',
                        width: 180,
                        render: (v: string) => <Text code>{v}</Text>,
                      },
                      {
                        title: '类型',
                        dataIndex: 'type',
                        width: 120,
                        render: (v: string) => <Text type="secondary">{v}</Text>,
                      },
                      {
                        title: '别名（可编辑）',
                        dataIndex: 'alias',
                        width: 200,
                        render: (val: string, record: FieldRow) => (
                          <Input
                            value={val}
                            size="small"
                            placeholder="添加中文别名"
                            onChange={(e) =>
                              handleCellEdit(tbl, record.key, 'alias', e.target.value)
                            }
                          />
                        ),
                      },
                      {
                        title: '字段描述（可编辑）',
                        dataIndex: 'description',
                        render: (val: string, record: FieldRow) => (
                          <Input.TextArea
                            value={val}
                            size="small"
                            placeholder="添加业务含义描述"
                            autoSize={{ minRows: 1, maxRows: 3 }}
                            onChange={(e) =>
                              handleCellEdit(tbl, record.key, 'description', e.target.value)
                            }
                          />
                        ),
                      },
                    ]}
                  />
                ),
              }))}
            />
          )}
        </Card>

        {/* Actions */}
        <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <Space>
            <Button size="large" onClick={() => navigate(`/w/${ws}/setup`)}>
              返回流程
            </Button>
            <Button
              type="primary"
              size="large"
              loading={saving}
              onClick={handleSave}
              style={{ background: 'var(--da-primary, #4338ca)', borderColor: 'var(--da-primary, #4338ca)' }}
            >
              保存并继续
            </Button>
          </Space>
        </div>
      </div>
    </div>
  );
};

export default SchemaReview;
