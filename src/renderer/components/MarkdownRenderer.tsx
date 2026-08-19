import {
  createContext,
  memo,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { Components } from 'react-markdown';
import ConfirmDialog from './ConfirmDialog';

type Props = {
  content: string;
  onImageClick?: (url: string) => void;
  /** Optional base URL used to resolve relative image/link paths (e.g. HuggingFace READMEs). */
  baseUrl?: string;
  /** Parse raw HTML embedded in the markdown (e.g. HuggingFace READMEs). */
  allowHtml?: boolean;
};

function resolveUrl(baseUrl: string | undefined, url: string): string {
  if (!url) return url;
  if (url.startsWith('#') || url.startsWith('//')) return url;

  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme === 'http' || scheme === 'https' || scheme === 'mailto') {
      return url;
    }
    return '';
  }

  if (!baseUrl) return url;
  return `${baseUrl}/${url.replace(/^\.?\//, '')}`;
}

export const CodeBlock = memo(function CodeBlockInner({
  lang,
  code,
}: {
  lang: string;
  code: string;
}) {
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
});

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
};

// Lets the module-level link component reach the instance-level
// confirmation handler without defining components during render.
const ExternalLinkContext = createContext<(url: string) => void>(() => {});

function MarkdownLink({
  href,
  children,
}: {
  href?: string;
  children?: ReactNode;
}) {
  const onOpenExternal = useContext(ExternalLinkContext);

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => {
        if (!href || href.startsWith('#')) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        onOpenExternal(href);
      }}
    >
      {children}
    </a>
  );
}

MarkdownLink.defaultProps = {
  href: '',
  children: undefined,
};

function MarkdownRenderer({
  content,
  onImageClick,
  baseUrl,
  allowHtml,
}: Props) {
  const cleaned = content.replace(/^\n+/, '');
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);

  const urlTransform = useCallback(
    (url: string) => resolveUrl(baseUrl, url),
    [baseUrl],
  );

  const componentsWithImg = useMemo<Components>(
    () => ({
      ...components,
      a: MarkdownLink,
      img({ src, alt, width, height }) {
        return (
          <img
            src={src}
            alt={alt || ''}
            width={width}
            height={height}
            onClick={() => {
              const resolved = src || '';
              if (onImageClick) {
                onImageClick(resolved);
              } else if (resolved) {
                setPendingUrl(resolved);
              }
            }}
            style={{ cursor: 'pointer' }}
          />
        );
      },
    }),
    [onImageClick],
  );

  const rehypePlugins = allowHtml ? [rehypeRaw, rehypeKatex] : [rehypeKatex];

  const openExternal = useCallback((url: string) => {
    setPendingUrl(url);
  }, []);

  const confirmExternal = () => {
    if (pendingUrl) {
      window.open(pendingUrl, '_blank', 'noopener,noreferrer');
    }
    setPendingUrl(null);
  };

  return (
    <>
      <ExternalLinkContext.Provider value={openExternal}>
        <div className="md">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={rehypePlugins}
            components={componentsWithImg}
            urlTransform={urlTransform}
          >
            {cleaned}
          </ReactMarkdown>
        </div>
      </ExternalLinkContext.Provider>

      {pendingUrl && (
        <ConfirmDialog
          title="External Link"
          message={
            <>
              You are about to leave Synapse and visit the following external
              site:
              <span className="confirm-dialog-url">{pendingUrl}</span>
            </>
          }
          confirmText="Continue"
          cancelText="Cancel"
          onConfirm={confirmExternal}
          onCancel={() => setPendingUrl(null)}
        />
      )}
    </>
  );
}

MarkdownRenderer.defaultProps = {
  onImageClick: undefined,
  baseUrl: undefined,
  allowHtml: false,
};

export default memo(
  MarkdownRenderer,
  (prev: Props, next: Props) =>
    prev.content === next.content &&
    prev.onImageClick === next.onImageClick &&
    prev.baseUrl === next.baseUrl &&
    prev.allowHtml === next.allowHtml,
);
