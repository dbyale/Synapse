import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { Components } from 'react-markdown';

type Props = {
  content: string;
  onImageClick?: (url: string) => void;
};

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopied(true);
        return setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  };

  return (
    <div className="md-code-block">
      <div className="md-code-block__header">
        <span className="md-code-block__lang">{lang || 'code'}</span>
        <button
          type="button"
          className={`md-code-block__copy ${copied ? 'md-code-block__copy--copied' : ''}`}
          onClick={handleCopy}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <SyntaxHighlighter
        language={lang || 'text'}
        style={oneDark}
        customStyle={{
          margin: 0,
          borderRadius: 0,
          fontSize: 13,
          lineHeight: 1.5,
          background: 'var(--bg-primary)',
        }}
        codeTagProps={{ style: { fontFamily: 'inherit' } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

const components: Components = {
  code({ className, children }) {
    const isInline = !className;
    const lang = (className ?? '').replace('language-', '');
    const code = String(children).replace(/\n$/, '');

    if (isInline) {
      return <code className={className}>{children}</code>;
    }

    return <CodeBlock lang={lang} code={code} />;
  },

  table({ children }) {
    return (
      <div className="md-table-wrapper">
        <table>{children}</table>
      </div>
    );
  },

  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  },
};

export default function MarkdownRenderer({ content, onImageClick }: Props) {
  const cleaned = content.replace(/^\n+/, '');

  const componentsWithImg: Components = {
    ...components,
    img({ src, alt }) {
      return (
        <img
          src={src}
          alt={alt || ''}
          onClick={() => onImageClick?.(src || '')}
          style={{ cursor: 'pointer' }}
        />
      );
    },
  };

  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={componentsWithImg}
      >
        {cleaned}
      </ReactMarkdown>
    </div>
  );
}
