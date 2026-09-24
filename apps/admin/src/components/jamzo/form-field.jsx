import { Label } from '@/components/ui/label';

/** Label + control + help + errors, wired for screen readers. */
export function FormField({ id, label, help, errors, children }) {
  const describedBy =
    [help ? `${id}-help` : null, errors?.length ? `${id}-error` : null].filter(Boolean).join(' ') ||
    undefined;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {typeof children === 'function'
        ? children({ id, 'aria-describedby': describedBy, 'aria-invalid': Boolean(errors?.length) })
        : children}
      {help ? (
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {help}
        </p>
      ) : null}
      {errors?.length ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {errors.join(' ')}
        </p>
      ) : null}
    </div>
  );
}
