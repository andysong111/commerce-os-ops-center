"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function LogoutPage() {
  const router = useRouter();

  useEffect(() => {
    let active = true;
    async function signOut() {
      const supabase = await createSupabaseBrowserClient();
      await supabase?.auth.signOut();
      if (active) {
        router.push("/login");
        router.refresh();
      }
    }
    signOut();
    return () => {
      active = false;
    };
  }, [router]);

  return <main className="p-8 text-sm font-semibold text-slate-600">로그아웃 중입니다...</main>;
}
