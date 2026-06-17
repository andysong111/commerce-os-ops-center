import { EngineRunnerConsole } from "@/components/engine-runners/EngineRunnerConsole";
import { PageHeader } from "@/components/PageHeader";
import {
  engineRunnerConfigs,
  isEngineDispatchTokenConfigured,
} from "@/lib/engineRunnerConfig";

const config = engineRunnerConfigs.find(
  (runner) => runner.kind === "detail_page_engine",
)!;

export default function DetailPageEngineRunnerPage() {
  return (
    <>
      <PageHeader
        title="Detail Page Engine Runner"
        description="Dispatch detail-page generation workflows and review generated artifacts in OPS CENTER."
      />
      <EngineRunnerConsole
        config={config}
        tokenConfigured={isEngineDispatchTokenConfigured()}
        safetyBanner="This runner dispatches the external detail-page engine repo. It does not call 1688/OpenAI from OPS CENTER and does not publish pages."
        reviewButtonLabel="Open Detail Page Draft Review / Preview"
        fields={[
          { name: "product_code", label: "product_code", placeholder: "e.g. BATH001" },
          { name: "source_link", label: "source_link", placeholder: "Primary source URL" },
          { name: "source_links", label: "optional source_links", type: "textarea", placeholder: "One source URL per line" },
          { name: "planning_point", label: "planning_point" },
          { name: "option_info", label: "option_info" },
          { name: "target", label: "target" },
        ]}
      />
    </>
  );
}
