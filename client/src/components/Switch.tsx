import { useId } from 'react';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  id?: string;
}

/**
 * Accessible native HTML switch control (<input type="checkbox" switch>),
 * conditionally enhanced by input-switch-polyfill in browsers without native support.
 */
export function Switch({ checked, onChange, label, disabled = false, id }: SwitchProps) {
  const autoId = useId();
  const inputId = id || autoId;

  return (
    <label className="switch-row" htmlFor={inputId}>
      <input
        id={inputId}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        {...({ switch: '' } as Record<string, string>)}
      />
      {label && <span>{label}</span>}
    </label>
  );
}
