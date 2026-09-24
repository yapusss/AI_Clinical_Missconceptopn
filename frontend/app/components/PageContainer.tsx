import type { ComponentPropsWithoutRef } from "react";

type Props = ComponentPropsWithoutRef<"div">;

export default function PageContainer({ className = "", ...props }: Props) {
  return <div className={`mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 ${className}`} {...props} />;
}
