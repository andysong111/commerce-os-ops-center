import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";

export default function SourcingSettingsPage() {
  return (
    <>
      <PageHeader
        title="Sourcing Engine Settings"
        description="Check helper connections and available sourcing tools."
        actions={
          <Link
            href="/sourcing-engine"
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Back
          </Link>
        }
      />
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-bold text-slate-950">Available tools</h2>
        <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
          <li>1688 candidate parser</li>
          <li>Risk filter</li>
          <li>Test cost estimate</li>
          <li>Recommendation card</li>
          <li>Feedback memory</li>
        </ul>
      </section>
    </>
  );
}
