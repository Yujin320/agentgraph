import ReactMarkdown from 'react-markdown';

interface Props {
  text: string;
  loading?: boolean;
}

export default function StreamingText({ text, loading }: Props) {
  return (
    <div
      className="streaming-text"
      style={{
        padding: '12px 16px',
        background: 'var(--da-bg-muted)',
        borderRadius: 10,
        borderLeft: '3px solid var(--da-primary)',
        minHeight: 40,
        color: 'var(--da-text-primary)',
      }}
    >
      {text ? (
        <ReactMarkdown>{text}</ReactMarkdown>
      ) : (
        loading ? <span style={{ color: 'var(--da-text-muted)' }}>正在分析...</span> : null
      )}
      {loading && <span className="typing-cursor">|</span>}
    </div>
  );
}
