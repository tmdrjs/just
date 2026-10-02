import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

const base =
  "w-full rounded-lg border border-line bg-bg px-3 py-2.5 text-sm text-fg placeholder:text-muted/70 outline-none transition-colors focus:border-accent/70 focus:ring-2 focus:ring-accent/20";

export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between text-xs font-medium text-sub">
      <span>{children}</span>
      {hint && <span className="font-normal text-muted">{hint}</span>}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${base} ${props.className ?? ""}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${base} resize-none ${props.className ?? ""}`} />;
}
