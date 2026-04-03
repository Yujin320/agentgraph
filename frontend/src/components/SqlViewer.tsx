import { Collapse, Typography } from 'antd';
import { CodeOutlined } from '@ant-design/icons';

export default function SqlViewer({ sql }: { sql: string }) {
  if (!sql) return null;
  return (
    <Collapse
      size="small"
      ghost
      items={[
        {
          key: 'sql',
          label: (
            <span>
              <CodeOutlined /> 查看 SQL
            </span>
          ),
          children: (
            <Typography.Text
              code
              style={{
                display: 'block',
                whiteSpace: 'pre-wrap',
                fontSize: 12,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                background: 'var(--da-bg-code)',
                color: 'var(--da-code-text)',
                padding: 12,
                borderRadius: 8,
                border: '1px solid var(--da-border-subtle)',
              }}
            >
              {sql}
            </Typography.Text>
          ),
        },
      ]}
    />
  );
}
