import { Children, ReactNode, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

interface InfoTooltipProps {
  children?: ReactNode;
  title?: string;
  content: string | string[];
  side?: 'top' | 'bottom' | 'left' | 'right';
  iconSize?: number;
  className?: string;
  style?: CSSProperties;
  hideIcon?: boolean;
  stretch?: boolean;
  portal?: boolean;
}

export default function InfoTooltip({
  children,
  title,
  content,
  side = 'bottom',
  iconSize = 14,
  className = '',
  style,
  hideIcon = false,
  stretch = false,
  portal = false,
}: InfoTooltipProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!portal || !rect) return undefined;
    const update = () => {
      const el = wrapperRef.current;
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [portal, rect]);

  const renderBody = () => (
    <>
      {title && <div className="info-tooltip-title">{title}</div>}
      {Array.isArray(content) ? (
        <ul className="info-tooltip-list">
          {content.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      ) : (
        <div className="info-tooltip-text">{content}</div>
      )}
    </>
  );

  const getPortalStyle = (): CSSProperties | undefined => {
    if (!rect) return undefined;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    if (side === 'bottom') {
      return {
        top: rect.bottom + 8,
        left: centerX,
        transform: 'translateX(-50%)',
      };
    }
    if (side === 'top') {
      return {
        bottom: window.innerHeight - rect.top + 8,
        left: centerX,
        transform: 'translateX(-50%)',
      };
    }
    if (side === 'left') {
      return {
        right: window.innerWidth - rect.left + 8,
        top: centerY,
        transform: 'translateY(-50%)',
      };
    }
    return {
      left: rect.right + 8,
      top: centerY,
      transform: 'translateY(-50%)',
    };
  };

  if (stretch && !portal) {
    const childArray = Children.toArray(children);
    const firstChild = childArray[0];
    const restChildren = childArray.slice(1);
    return (
      <div
        className={`info-tooltip-wrapper info-tooltip-wrapper--${side} info-tooltip-wrapper--stretch${className ? ` ${className}` : ''}`}
        style={style}
      >
        <div
          className={`info-tooltip-anchor${restChildren.length === 0 ? ' info-tooltip-anchor--fill' : ''}`}
        >
          {firstChild}
          <div className="info-tooltip">{renderBody()}</div>
        </div>
        {restChildren}
      </div>
    );
  }

  if (portal) {
    return (
      <>
        <div
          ref={wrapperRef}
          className={`info-tooltip-wrapper info-tooltip-wrapper--${side}${className ? ` ${className}` : ''}`}
          style={style}
          onMouseEnter={() => {
            const el = wrapperRef.current;
            if (el) setRect(el.getBoundingClientRect());
          }}
          onMouseLeave={() => setRect(null)}
        >
          {children}
        </div>
        {rect &&
          createPortal(
            <div
              className={`info-tooltip info-tooltip--portal info-tooltip--portal--${side}`}
              style={getPortalStyle()}
            >
              {renderBody()}
            </div>,
            document.body,
          )}
      </>
    );
  }

  return (
    <div
      className={`info-tooltip-wrapper info-tooltip-wrapper--${side}${className ? ` ${className}` : ''}`}
      style={style}
    >
      {children}
      {!hideIcon && (
        <span className="info-tooltip-trigger">
          <Info size={iconSize} className="info-tooltip-icon" />
        </span>
      )}
      <div className="info-tooltip">{renderBody()}</div>
    </div>
  );
}
