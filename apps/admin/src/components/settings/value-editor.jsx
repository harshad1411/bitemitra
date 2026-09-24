'use client';

import { useState } from 'react';
import { formatPaise } from '@jamzo/ui';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

/** Field hint derived from naming conventions (DATABASE.md §2): *Paise = money, *Bps = basis points. */
function hint(key, value) {
  if (/Paise$/.test(key) && Number.isInteger(value))
    return `Paise — currently ${formatPaise(value)} (₹1 = 100 paise)`;
  if (/Bps$/.test(key) && Number.isInteger(value))
    return `Basis points — currently ${(value / 100).toFixed(2)}% (1% = 100)`;
  if (/Sec$/.test(key)) return 'Seconds';
  if (/Minutes$/.test(key)) return 'Minutes';
  if (/M$/.test(key) && Number.isInteger(value)) return 'Metres';
  return null;
}

function Field({ name, value, onChange, fieldErrors, path }) {
  const id = `f-${path.join('-')}`;
  const errors = fieldErrors[['value', ...path].join('.')];
  const h = hint(name, value);
  let control;
  if (typeof value === 'boolean') {
    control = <Switch id={id} checked={value} onCheckedChange={onChange} />;
  } else if (typeof value === 'number') {
    control = (
      <Input
        id={id}
        inputMode="numeric"
        value={String(value)}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      />
    );
  } else if (Array.isArray(value)) {
    const numeric = value.length > 0 && value.every((v) => typeof v === 'number');
    control = (
      <Input
        id={id}
        value={value.join(', ')}
        onChange={(e) => {
          const parts = e.target.value
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean);
          onChange(numeric ? parts.map(Number) : parts);
        }}
      />
    );
  } else {
    control = (
      <Input
        id={id}
        value={value ?? ''}
        placeholder={value === null ? 'Not set' : undefined}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      />
    );
  }
  return (
    <div className="grid gap-1">
      <Label htmlFor={id} className="font-mono text-xs">
        {name}
      </Label>
      {control}
      {Array.isArray(value) ? <p className="text-xs text-muted-foreground">Comma-separated list</p> : null}
      {h ? <p className="text-xs text-muted-foreground">{h}</p> : null}
      {errors ? <p className="text-xs text-destructive">{errors.join(' ')}</p> : null}
    </div>
  );
}

/**
 * Edits a setting value. Flat objects get one control per field; anything nested (or on request) is
 * edited as JSON. The API validates against the registry schema and returns field errors.
 */
export function ValueEditor({ value, onChange, fieldErrors = {} }) {
  const flat =
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => v === null || typeof v !== 'object' || Array.isArray(v));
  const primitive = value === null || typeof value !== 'object';
  const [json, setJson] = useState(!flat && !primitive);
  const [text, setText] = useState(JSON.stringify(value, null, 2));
  const [jsonError, setJsonError] = useState(null);

  if (json) {
    return (
      <div className="grid gap-1">
        <Textarea
          className="font-mono text-xs"
          rows={8}
          value={text}
          aria-label="Value as JSON"
          onChange={(e) => {
            setText(e.target.value);
            try {
              onChange(JSON.parse(e.target.value));
              setJsonError(null);
            } catch {
              setJsonError('Not valid JSON yet');
            }
          }}
        />
        {jsonError ? <p className="text-xs text-destructive">{jsonError}</p> : null}
        {fieldErrors.value ? <p className="text-xs text-destructive">{fieldErrors.value.join(' ')}</p> : null}
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      {primitive ? (
        <Field name="value" value={value} onChange={onChange} fieldErrors={fieldErrors} path={[]} />
      ) : (
        Object.entries(value).map(([k, v]) => (
          <Field
            key={k}
            name={k}
            value={v}
            path={[k]}
            fieldErrors={fieldErrors}
            onChange={(nv) => onChange({ ...value, [k]: nv })}
          />
        ))
      )}
      <Button
        variant="link"
        type="button"
        className="h-auto justify-start p-0 text-xs"
        onClick={() => (setText(JSON.stringify(value, null, 2)), setJson(true))}
      >
        Edit as JSON
      </Button>
    </div>
  );
}

export function renderValue(value) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">Not set</span>;
  if (typeof value !== 'object') return <span className="font-mono text-xs">{String(value)}</span>;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
      {Object.entries(value).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-mono text-muted-foreground">{k}</dt>
          <dd className="font-mono break-all">
            {Array.isArray(v) ? v.join(', ') || '—' : v === null ? '—' : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
