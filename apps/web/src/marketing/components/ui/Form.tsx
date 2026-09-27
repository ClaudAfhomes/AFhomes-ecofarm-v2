import { useId, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cn } from "../../lib/cn";

const controlBase =
  "w-full rounded-xl border bg-white/80 px-4 py-3.5 text-base text-ink-800 placeholder:text-ink-400/80 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-leaf-500/40";

function controlBorder(hasError?: boolean) {
  return hasError
    ? "border-red-400 focus:border-red-500"
    : "border-line hover:border-navy-300 focus:border-leaf-600";
}

interface FormFieldProps {
  id: string;
  label: string;
  required?: boolean;
  error?: string | null;
  hint?: string;
  children: ReactNode;
}

export function FormField({ id, label, required, error, hint, children }: FormFieldProps) {
  return (
    <div>
      <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <label htmlFor={id} className="text-sm font-semibold tracking-wide text-navy-900">
          {label}
          {required && (
            <span className="ml-1 text-leaf-700" aria-hidden="true">
              *
            </span>
          )}
        </label>
        {error && (
          <span id={`${id}-error`} role="alert" className="text-xs font-medium text-red-600">
            {error}
          </span>
        )}
      </div>
      {children}
      {!error && hint && <p className="mt-2 text-sm text-ink-400">{hint}</p>}
    </div>
  );
}

interface FieldInputProps extends ComponentPropsWithoutRef<"input"> {
  invalid?: boolean;
}

export function FieldInput({ invalid, className, ...props }: FieldInputProps) {
  return <input className={cn(controlBase, controlBorder(invalid), className)} {...props} />;
}

interface FieldTextareaProps extends ComponentPropsWithoutRef<"textarea"> {
  invalid?: boolean;
}

export function FieldTextarea({ invalid, className, ...props }: FieldTextareaProps) {
  return (
    <textarea className={cn(controlBase, controlBorder(invalid), "min-h-36 resize-y", className)} {...props} />
  );
}

interface FieldSelectProps extends ComponentPropsWithoutRef<"select"> {
  invalid?: boolean;
}

export function FieldSelect({ invalid, className, children, ...props }: FieldSelectProps) {
  return (
    <span className="relative block">
      <select
        className={cn(controlBase, controlBorder(invalid), "appearance-none pr-10", className)}
        {...props}
      >
        {children}
      </select>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3.5 h-4 w-4 -translate-y-1/2 text-ink-400"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </span>
  );
}

export function useFormFieldId(prefix: string) {
  return useId().replace(/[:]/g, "") + `-${prefix}`;
}