import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type Props = {
  title: string;
  description?: string;
  icon?: LucideIcon;
  eyebrow?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export default function PageHeader({
  title,
  description,
  icon: Icon,
  eyebrow,
  action,
  className = "",
}: Props) {
  return (
    <header className={`flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between ${className}`}>
      <div className={`flex gap-3.5 ${eyebrow ? "items-start" : "items-center"}`}>
        {Icon && (
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary-fixed text-primary">
            <Icon size={24} aria-hidden="true" />
          </div>
        )}
        <div>
          {eyebrow && <div className="mb-2">{eyebrow}</div>}
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-on-surface">{title}</h1>
          {description && <p className="mt-0.5 text-sm text-on-surface-variant leading-relaxed">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0 sm:self-center">{action}</div>}
    </header>
  );
}
