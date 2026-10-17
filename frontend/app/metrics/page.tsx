"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Hidden on 2026-10-17: the model-metrics surface is not in use right now, so the
 * route forwards to the dashboard instead of rendering. The sidebar entry is gone
 * too, so nobody reaches it by navigation — this guard only catches a bookmarked
 * or typed URL.
 *
 * Nothing was deleted: the API (`/api/metrics/...`) is untouched, and the previous
 * implementation of this page is intact in git. Restore it with
 *   git revert <this commit>
 * or `git show dd455a09:frontend/app/metrics/page.tsx > frontend/app/metrics/page.tsx`
 * plus re-adding the `Metrik Model` entry in `app/components/AppSidebar.tsx`.
 */
export default function MetricsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard");
  }, [router]);

  return null;
}
