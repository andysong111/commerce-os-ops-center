import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { validateSourcingStorageConfig, getSourcingStorageConfig } from "@/lib/sourcingServerStorage";

export default async function SourcingSettingsPage() {
  const config = validateSourcingStorageConfig();
  const storageConfig = getSourcingStorageConfig();
  const supabase = await createSupabaseServerClient();
  const { data } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
  const email = data.user?.email ?? "Not signed in";
  const organizationId = process.env.SOURCING_ORGANIZATION_ID ?? "Not configured";
  const cardsUsable = config.ok && Boolean(data.user) && Boolean(process.env.SOURCING_ORGANIZATION_ID);

  return (
    <>
      <PageHeader
        title="Sourcing Engine Settings"
        description="Check helper connections, auth state, and Supabase-backed sourcing storage."
        actions={<Link href="/sourcing-engine" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Back</Link>}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold text-slate-950">API status</h2>
          <dl className="mt-3 space-y-3 text-sm">
            <StatusRow label="Supabase env configured" value={config.ok ? "Yes" : `No (${config.missing.join(", ")})`} ok={config.ok} />
            <StatusRow label="Supabase public key env" value={storageConfig.supabasePublicKeyName ?? "Not configured"} ok={Boolean(storageConfig.supabasePublicKeyName)} />
            <StatusRow label="Signed-in user" value={email} ok={Boolean(data.user)} />
            <StatusRow label="SOURCING_ORGANIZATION_ID" value={organizationId} ok={Boolean(process.env.SOURCING_ORGANIZATION_ID)} />
            <StatusRow label="/api/sourcing/cards usable" value={cardsUsable ? "Yes" : "No — localStorage fallback remains active"} ok={cardsUsable} />
          </dl>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold text-slate-950">Available tools</h2>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
            <li>1688 candidate parser</li><li>Risk filter</li><li>Test cost estimate</li><li>Recommendation card</li><li>Feedback memory</li>
          </ul>
        </section>
      </div>
    </>
  );
}

function StatusRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-2 last:border-0"><dt className="font-semibold text-slate-600">{label}</dt><dd className={ok ? "text-right font-bold text-emerald-700" : "text-right font-bold text-amber-700"}>{value}</dd></div>;
}
