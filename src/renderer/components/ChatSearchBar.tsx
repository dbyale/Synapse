/* eslint-disable no-plusplus, no-continue, no-restricted-syntax, react/require-default-props */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react';

interface ChatSearchBarProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  messageCount?: number;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function supportsHighlight(): boolean {
  return (
    typeof CSS !== 'undefined' &&
    'highlights' in CSS &&
    typeof (window as any).Highlight !== 'undefined'
  );
}

export default function ChatSearchBar({
  containerRef,
  onClose,
  messageCount = 0,
}: ChatSearchBarProps) {
  const [query, setQuery] = useState('');
  const [total, setTotal] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const rangesRef = useRef<Range[]>([]);
  const marksRef = useRef<HTMLElement[]>([]);
  const isHighlightingRef = useRef(false);

  const clearHighlights = useCallback(() => {
    if (supportsHighlight()) {
      try {
        (CSS as any).highlights.delete('chat-search');
        (CSS as any).highlights.delete('chat-search-current');
      } catch {
        // ignore
      }
    }
    // fallback marks cleanup
    const container = containerRef.current;
    if (container && marksRef.current.length > 0) {
      isHighlightingRef.current = true;
      marksRef.current.forEach((mark) => {
        const parent = mark.parentNode;
        if (!parent) return;
        while (mark.firstChild) {
          parent.insertBefore(mark.firstChild, mark);
        }
        parent.removeChild(mark);
      });
      // normalize text nodes
      container.normalize();
      marksRef.current = [];
      isHighlightingRef.current = false;
    }
    rangesRef.current = [];
  }, [containerRef]);

  const updateCurrentHighlight = useCallback((idx: number) => {
    if (supportsHighlight()) {
      try {
        const ranges = rangesRef.current;
        if (idx >= 0 && idx < ranges.length) {
          const cur = new (window as any).Highlight(ranges[idx]);
          (CSS as any).highlights.set('chat-search-current', cur);
        } else {
          (CSS as any).highlights.delete('chat-search-current');
        }
      } catch {
        // ignore
      }
    } else {
      // fallback: toggle class
      marksRef.current.forEach((m, i) => {
        if (i === idx) m.classList.add('chat-search-highlight--current');
        else m.classList.remove('chat-search-highlight--current');
      });
    }
  }, []);

  const scrollTo = useCallback(
    (idx: number) => {
      const container = containerRef.current;
      if (!container) return;
      let el: HTMLElement | null = null;
      if (marksRef.current.length > 0) {
        el = marksRef.current[idx] as HTMLElement | null;
      } else {
        const range = rangesRef.current[idx];
        if (range) {
          const node = range.startContainer as any;
          el = node.parentElement as HTMLElement | null;
          // If parent is not element (text node directly?), fallback
          if (!el && node.parentNode) el = node.parentNode as HTMLElement;
        }
      }
      if (!el) return;

      // If element is inside a collapsed bubble or hidden thought, try to expand
      // Find closest collapsed message bubble
      const collapsedBubble = el.closest('.chat-message__bubble--collapsed');
      if (collapsedBubble) {
        (collapsedBubble as HTMLElement).click();
        // after expand, need to re-find; but best effort scroll after small delay
        setTimeout(
          () => el?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
          50,
        );
        return;
      }
      // Try to expand thought segment if its container is hidden (isOpen false means not in DOM, so no need)
      // Scroll into view within the scrollable container
      // We use scrollIntoView which will scroll the nearest scrollable ancestor (chat-messages)
      try {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        // Also ensure chat-messages container scrolls if needed (extra insurance)
        // Check if element is out of view due to container overflow
        const containerRect = container.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        if (
          elRect.top < containerRect.top ||
          elRect.bottom > containerRect.bottom
        ) {
          // scrollIntoView already handled, but if Highlight API, element still scrolled
        }
      } catch {
        // fallback
        container.scrollTop = el.offsetTop - container.clientHeight / 2;
      }
    },
    [containerRef],
  );

  const applyHighlights = useCallback(
    (ranges: Range[], currentIdx: number) => {
      if (supportsHighlight()) {
        try {
          if (ranges.length > 0) {
            const highlight = new (window as any).Highlight(...ranges);
            (CSS as any).highlights.set('chat-search', highlight);
          } else {
            (CSS as any).highlights.delete('chat-search');
          }
          updateCurrentHighlight(currentIdx);
        } catch {
          // fallback to marks if Highlight fails
        }
      } else {
        // fallback: wrap ranges with <mark>
        const container = containerRef.current;
        if (!container) return;
        isHighlightingRef.current = true;
        // Process in reverse to keep offsets valid
        const marks: HTMLElement[] = new Array(ranges.length);
        for (let i = ranges.length - 1; i >= 0; i--) {
          const range = ranges[i];
          const mark = document.createElement('mark');
          mark.className = 'chat-search-highlight';
          mark.dataset.index = String(i);
          try {
            range.surroundContents(mark);
            marks[i] = mark;
          } catch {
            try {
              const frag = range.extractContents();
              mark.appendChild(frag);
              range.insertNode(mark);
              marks[i] = mark;
            } catch {
              // skip invalid range
            }
          }
        }
        marksRef.current = marks.filter(Boolean) as HTMLElement[];
        // set current class
        if (currentIdx >= 0) {
          const cur = marksRef.current[currentIdx];
          if (cur) cur.classList.add('chat-search-highlight--current');
        }
        isHighlightingRef.current = false;
      }
    },
    [containerRef, updateCurrentHighlight],
  );

  const performSearch = useCallback(
    (q: string) => {
      clearHighlights();
      if (!q.trim()) {
        setTotal(0);
        setActiveIndex(-1);
        return;
      }
      const container = containerRef.current;
      if (!container) {
        setTotal(0);
        setActiveIndex(-1);
        return;
      }
      const escaped = escapeRegExp(q);
      let regex: RegExp;
      try {
        regex = new RegExp(escaped, 'gi');
      } catch {
        setTotal(0);
        setActiveIndex(-1);
        return;
      }

      const ranges: Range[] = [];
      const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            const text = node.nodeValue || '';
            if (!text.trim()) return NodeFilter.FILTER_REJECT;
            const parent = (node as Text).parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            // Skip script/style and our own search bar if ever inside
            const tag = parent.tagName;
            if (tag === 'SCRIPT' || tag === 'STYLE')
              return NodeFilter.FILTER_REJECT;
            // Skip hidden or not rendered
            // offsetParent null means hidden, but also for fixed? We check visible via CSS
            const style = window.getComputedStyle(parent);
            if (style.display === 'none' || style.visibility === 'hidden')
              return NodeFilter.FILTER_REJECT;
            // Skip marks we inserted (avoid recursion)
            if (parent.closest('mark.chat-search-highlight'))
              return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          },
        },
      );

      let node: Text | null;
      // eslint-disable-next-line no-cond-assign
      while ((node = walker.nextNode() as Text | null)) {
        const text = node.nodeValue || '';
        regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        // Collect matches for this node before creating ranges to avoid modifying while iterating
        const matches: { start: number; end: number }[] = [];
        // eslint-disable-next-line no-cond-assign
        while ((match = regex.exec(text)) !== null) {
          const start = match.index;
          const end = start + match[0].length;
          if (match[0].length === 0) {
            regex.lastIndex++;
            continue;
          }
          matches.push({ start, end });
          // prevent infinite loop for zero-length
          if (regex.lastIndex === match.index) regex.lastIndex++;
        }
        // Create ranges for each match in this node (offsets are stable until DOM mutation)
        for (const m of matches) {
          try {
            const range = document.createRange();
            range.setStart(node, m.start);
            range.setEnd(node, m.end);
            ranges.push(range);
          } catch {
            // ignore invalid offsets
          }
        }
      }

      rangesRef.current = ranges;
      setTotal(ranges.length);
      const nextIdx = ranges.length > 0 ? 0 : -1;
      setActiveIndex(nextIdx);
      if (ranges.length > 0) {
        applyHighlights(ranges, 0);
        // scroll to first after next tick to ensure highlights applied
        requestAnimationFrame(() => scrollTo(0));
      } else {
        clearHighlights();
      }
    },
    [clearHighlights, containerRef, applyHighlights, scrollTo],
  );

  // Trigger search when query changes
  useEffect(() => {
    const id = setTimeout(() => {
      performSearch(query);
    }, 120);
    return () => clearTimeout(id);
  }, [query, performSearch]);

  // Re-run when messageCount changes (new messages/stream)
  useEffect(() => {
    if (query.trim()) {
      // small debounce to allow DOM to settle
      const id = setTimeout(() => performSearch(query), 80);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [messageCount, query, performSearch]);

  // Handle activeIndex changes (navigation)
  useEffect(() => {
    if (activeIndex >= 0 && rangesRef.current.length > 0) {
      updateCurrentHighlight(activeIndex);
      scrollTo(activeIndex);
    } else if (activeIndex === -1) {
      updateCurrentHighlight(-1);
    }
  }, [activeIndex, updateCurrentHighlight, scrollTo]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Cleanup on unmount / close
  useEffect(() => {
    return () => {
      clearHighlights();
    };
  }, [clearHighlights]);

  // MutationObserver to re-run search on DOM changes (streaming, new messages)
  // Guarded by isHighlightingRef to avoid reacting to our own highlight mutations
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !query.trim()) return undefined;
    let debounceId: ReturnType<typeof setTimeout> | null = null;
    const observer = new MutationObserver(() => {
      if (isHighlightingRef.current) return;
      if (debounceId) clearTimeout(debounceId);
      debounceId = setTimeout(() => performSearch(query), 180);
    });
    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      observer.disconnect();
      if (debounceId) clearTimeout(debounceId);
    };
  }, [query, performSearch, containerRef]);

  const goNext = useCallback(() => {
    if (total === 0) return;
    setActiveIndex((prev) => {
      const next = prev + 1 >= total ? 0 : prev + 1;
      return next;
    });
  }, [total]);

  const goPrev = useCallback(() => {
    if (total === 0) return;
    setActiveIndex((prev) => {
      const next = prev - 1 < 0 ? total - 1 : prev - 1;
      return next;
    });
  }, [total]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) goPrev();
      else goNext();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'F3') {
      e.preventDefault();
      if (e.shiftKey) goPrev();
      else goNext();
    }
  };

  let countText = '';
  if (!query.trim()) countText = '';
  else if (total === 0) countText = 'No results';
  else countText = `${activeIndex + 1} of ${total}`;

  return (
    <div className="chat-search-bar" role="search" aria-label="Find in chat">
      <Search size={14} className="chat-search-bar__icon" />
      <input
        ref={inputRef}
        type="text"
        className="chat-search-bar__input"
        placeholder="Find in chat…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        aria-label="Search chat"
      />
      {query && (
        <span
          className={`chat-search-bar__count${total === 0 ? ' chat-search-bar__count--empty' : ''}`}
        >
          {countText}
        </span>
      )}
      <div className="chat-search-bar__actions">
        <button
          type="button"
          className="chat-search-bar__nav"
          onClick={goPrev}
          disabled={total === 0}
          aria-label="Previous match (Shift+Enter)"
          title="Previous (Shift+Enter)"
        >
          <ChevronUp size={16} />
        </button>
        <button
          type="button"
          className="chat-search-bar__nav"
          onClick={goNext}
          disabled={total === 0}
          aria-label="Next match (Enter)"
          title="Next (Enter)"
        >
          <ChevronDown size={16} />
        </button>
        <button
          type="button"
          className="chat-search-bar__close"
          onClick={onClose}
          aria-label="Close search (Esc)"
          title="Close (Esc)"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
