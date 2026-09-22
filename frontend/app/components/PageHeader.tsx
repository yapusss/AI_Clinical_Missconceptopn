import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type Props = { title: string; description?: string; icon?: LucideIcon; eyebrow?: ReactNode; action?: ReactNode; className?: string };

export default function PageHeader({ title, description, icon: Icon, eyebrow, action, className = "" }: Props) {
  return <header className={`flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between ${className}`}><div className="flex items-start gap-3">{Icon && <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary-fixed text-primary"><Icon size={25} aria-hidden="true" /></div>}<div>{eyebrow && <div className="mb-2">{eyebrow}</div>}<h1 className="font-display text-2xl font-extrabold tracking-tight text-on-surface">{title}</h1>{description && <p className="mt-1 text-sm text-on-surface-variant">{description}</p>}</div></div>{action}</header>;
}
