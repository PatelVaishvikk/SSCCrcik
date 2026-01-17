"use client";

import { useRouter, usePathname } from "next/navigation";

export default function BackBar({ fallback = "/" }: { fallback?: string }) {
  const router = useRouter();
  const pathname = usePathname();

  if (pathname === "/") return null;

  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push(fallback);
    }
  };

  return (
    <div className="back-row">
      <button type="button" className="pill" onClick={goBack}>
        Back
      </button>
    </div>
  );
}
