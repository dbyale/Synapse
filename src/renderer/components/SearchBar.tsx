import { ChangeEvent } from 'react';
import { Search } from 'lucide-react';
import './styles/SearchBar.css';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  className?: string;
}

export default function SearchBar({
  value,
  onChange,
  placeholder,
  ariaLabel,
  autoFocus,
  className,
}: SearchBarProps) {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  return (
    <div className={`search-bar${className ? ` ${className}` : ''}`}>
      <Search size={16} className="search-bar__icon" />
      <input
        type="text"
        className="input-base search-bar__input"
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        aria-label={ariaLabel ?? placeholder}
        autoFocus={autoFocus}
      />
    </div>
  );
}
