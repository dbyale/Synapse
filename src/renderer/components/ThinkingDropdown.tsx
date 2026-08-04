import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Lightbulb, LightbulbOff } from 'lucide-react';
import './styles/ThinkingDropdown.css';

const THINKING_OPTIONS = [
  { label: 'Off', tokens: 0, tokenLabel: 'Off' },
  { label: 'Low', tokens: 512, tokenLabel: '512 tokens' },
  { label: 'Medium', tokens: 2048, tokenLabel: '2048 tokens' },
  { label: 'High', tokens: 8192, tokenLabel: '8192 tokens' },
  { label: 'Max', tokens: -1, tokenLabel: 'Unlimited tokens' },
] as const;

const DEFAULT_THINKING_TOKENS = 8192;
const VALID_TOKENS = new Set(THINKING_OPTIONS.map((o) => o.tokens));

function readThinkingTokens(profileId: string | null | undefined): number {
  if (!profileId) return DEFAULT_THINKING_TOKENS;
  try {
    const stored = localStorage.getItem('profiles');
    if (stored) {
      const parsed = JSON.parse(stored);
      const profile = (parsed as any[]).find((p) => p.id === profileId);
      if (profile && VALID_TOKENS.has(profile.thinkingTokens)) {
        return profile.thinkingTokens;
      }
    }
  } catch {
    // Fall through to default
  }
  return DEFAULT_THINKING_TOKENS;
}

export default function ThinkingDropdown({
  profileId,
  onTokensChange,
}: {
  profileId: string | null;
  onTokensChange: (tokens: number) => void;
}) {
  const [tokens, setTokens] = useState<number>(() =>
    readThinkingTokens(profileId),
  );
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ left: number; top: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTokens(readThinkingTokens(profileId));
  }, [profileId]);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e: MouseEvent) => {
      if (buttonRef.current?.contains(e.target as Node)) return;
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  const currentOpt =
    THINKING_OPTIONS.find((o) => o.tokens === tokens) ?? THINKING_OPTIONS[3];

  const toggle = () => {
    if (!open) {
      const b = buttonRef.current?.getBoundingClientRect();
      if (b) setRect({ left: b.left, top: b.top });
    }
    setOpen((v) => !v);
  };

  const select = (t: number) => {
    setTokens(t);
    setOpen(false);
    onTokensChange(t);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="chat-thinking-button"
        onClick={toggle}
        title="Thinking budget"
      >
        {tokens === 0 ? <LightbulbOff size={14} /> : <Lightbulb size={14} />}
        <span className="chat-thinking-button__label">{currentOpt.label}</span>
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            className="chat-thinking-dropdown"
            style={{
              left: rect.left,
              bottom: window.innerHeight - rect.top + 8,
            }}
          >
            {THINKING_OPTIONS.map((opt) => {
              const Icon = opt.tokens === 0 ? LightbulbOff : Lightbulb;
              const isActive = tokens === opt.tokens;
              return (
                <button
                  key={opt.tokens}
                  type="button"
                  className={`chat-thinking-dropdown__item${isActive ? ' chat-thinking-dropdown__item--active' : ''}`}
                  onClick={() => select(opt.tokens)}
                >
                  <Icon size={14} />
                  <span className="chat-thinking-dropdown__label">
                    {opt.label}
                  </span>
                  <span className="chat-thinking-dropdown__tokens">
                    {opt.tokenLabel}
                  </span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
