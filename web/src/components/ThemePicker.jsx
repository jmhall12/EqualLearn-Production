import { Check, Moon } from 'lucide-react';

export default function ThemePicker({ compact = false }) {
  return (
    <div className={`theme-options ${compact ? 'compact' : ''}`} aria-label="EqualLearn appearance">
      <button
        type="button"
        title="EqualLearn dark theme is always enabled"
        aria-label="EqualLearn Dark theme is enabled on all devices"
        aria-pressed="true"
        className="theme-option active"
        disabled
      >
        <span className="theme-swatch" style={{ background: 'linear-gradient(135deg,#263454 0 50%,#101a2d 50% 100%)' }}>
          <Moon size={compact ? 12 : 16} />
        </span>
        {!compact && <span className="theme-copy"><strong>EqualLearn Dark</strong><small>Always on Â· all devices</small></span>}
        {!compact && <Check className="theme-check" size={16} />}
      </button>
    </div>
  );
}
