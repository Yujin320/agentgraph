import { Table } from 'antd';
import type { ColumnType } from 'antd/es/table';

interface Props {
  columns: string[];
  rows: unknown[][];
  maxHeight?: number;
}

export default function DataTable({ columns, rows, maxHeight = 300 }: Props) {
  const antColumns: ColumnType<Record<string, unknown>>[] = columns.map((col, i) => ({
    title: col,
    dataIndex: i.toString(),
    key: col,
    ellipsis: true,
  }));

  const dataSource: Record<string, unknown>[] = rows.map((row, idx) => {
    const record: Record<string, unknown> = { key: idx };
    row.forEach((val, i) => {
      record[i.toString()] = val;
    });
    return record;
  });

  return (
    <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--da-border-base)' }}>
      <Table<Record<string, unknown>>
        columns={antColumns}
        dataSource={dataSource}
        size="small"
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
        }}
        scroll={{ x: 'max-content', y: maxHeight }}
      />
    </div>
  );
}
