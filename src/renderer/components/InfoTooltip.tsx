import { Children, ReactNode } from 'react';
import { Info } from 'lucide-react';

interface InfoTooltipProps {
  children?: ReactNode;
  title?: string;
  content: string | string[];
  side?: 'top' | 'bottom' | 'left' | 'right';
  iconSize?: number;
  className?: string;
  style?: React.CSSProperties;
  hideIcon?: boolean;
  stretch?: boolean;
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
}: InfoTooltipProps) {
  if (stretch) {
    const childArray = Children.toArray(children);
    const firstChild = childArray[0];
    const restChildren = childArray.slice(1);
    return (
      <div
        className={`info-tooltip-wrapper info-tooltip-wrapper--${side} info-tooltip-wrapper--stretch${className ? ` ${className}` : ''}`}
        style={style}
      >
        <div className={`info-tooltip-anchor${restChildren.length === 0 ? ' info-tooltip-anchor--fill' : ''}`}>
          {firstChild}
          <div className="info-tooltip">
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
          </div>
        </div>
        {restChildren}
      </div>
    );
  }

  return (
    <div className={`info-tooltip-wrapper info-tooltip-wrapper--${side}${className ? ` ${className}` : ''}`} style={style}>
      {children}
      {!hideIcon && (
        <span className="info-tooltip-trigger">
          <Info size={iconSize} className="info-tooltip-icon" />
        </span>
      )}
      <div className="info-tooltip">
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
      </div>
    </div>
  );
}
