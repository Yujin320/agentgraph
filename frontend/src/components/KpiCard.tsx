import { Card, Statistic, Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';

interface Props {
  label: string;
  value: number | string | null;
  format?: string;
  help?: string;
  loading?: boolean;
  error?: string | null;
}

export default function KpiCard({ label, value, format, help, loading, error }: Props) {
  let displayValue: string | number = '--';

  if (error) {
    displayValue = '错误';
  } else if (value !== null && value !== undefined) {
    if (format) {
      displayValue = format.replace(
        /\{[^}]*\}/,
        String(typeof value === 'number' ? value.toFixed(1) : value),
      );
    } else {
      displayValue = typeof value === 'number' ? value.toFixed(1) : String(value);
    }
  }

  return (
    <Card
      size="small"
      style={{
        borderRadius: 10,
        border: '1px solid var(--da-border-base)',
        background: 'var(--da-bg-card)',
        boxShadow: 'var(--da-shadow-card)',
      }}
      loading={loading}
    >
      <Statistic
        title={
          <span style={{ color: 'var(--da-text-secondary)' }}>
            {label}
            {help && (
              <Tooltip title={help}>
                <QuestionCircleOutlined style={{ marginLeft: 4, color: 'var(--da-text-muted)' }} />
              </Tooltip>
            )}
          </span>
        }
        value={displayValue}
        valueStyle={{ color: error ? 'var(--da-danger)' : 'var(--da-primary)', fontSize: 24 }}
      />
    </Card>
  );
}
