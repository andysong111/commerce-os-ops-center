import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  extractModelNumber,
  getWorkspaceGroup,
  OPS_WORKSPACE_GROUPS,
  rankWorkspaceModules,
  resolveOpsCommand,
} from "../src/lib/opsWorkspace.ts";

const dashboardSource = await readFile(
  new URL("../src/components/dashboard/OpsDashboard.tsx", import.meta.url),
  "utf8",
);
const sidebarSource = await readFile(
  new URL("../src/components/Sidebar.tsx", import.meta.url),
  "utf8",
);
const retrySource = await readFile(
  new URL("../src/components/OpsRetryPrefill.tsx", import.meta.url),
  "utf8",
);

test("OPS Center groups modules into six operator workspaces", () => {
  assert.deepEqual(
    OPS_WORKSPACE_GROUPS.map((group) => group.id),
    [
      "sourcing-order",
      "warehouse-inbound",
      "product-launch",
      "content-keyword",
      "sales-price",
      "system-check",
    ],
  );
  assert.equal(
    getWorkspaceGroup("product-decision-agent")?.id,
    "sourcing-order",
  );
  assert.equal(
    getWorkspaceGroup("product-launch-tracker")?.id,
    "product-launch",
  );
  assert.equal(
    getWorkspaceGroup("shopling-price-adjustment-runner")?.id,
    "sales-price",
  );
});

test("natural-language and model-number search recommend the right tools", () => {
  const modules = [
    {
      id: "product-launch-tracker",
      title: "신규 상품 출시 진행관리",
      description: "신규 상품 출시 상태 관리",
      category: "상품 출시",
      inputType: "모델번호",
      outputType: "진행률",
    },
    {
      id: "shopling-price-adjustment-runner",
      title: "샵플링 판매가 인상·인하 실행기",
      description: "판매가를 조정합니다.",
      category: "가격",
      inputType: "goods_key",
      outputType: "실행 결과",
    },
  ].map((module) => ({
    ...module,
    navigationLabel: module.title,
    status: "available",
    route: "/test",
    historySupport: false,
    externalProject: false,
    note: null,
  }));

  assert.equal(extractModelNumber("AAA413 가격 올리기"), "AAA413");
  assert.equal(resolveOpsCommand("AAA413 가격 올리기")?.label, "가격 작업");
  assert.equal(
    rankWorkspaceModules(modules, "AAA413 가격 올리기")[0]?.id,
    "shopling-price-adjustment-runner",
  );
});

test("workspace search ignores spacing and punctuation without requiring an exact menu title", () => {
  const modules = [
    {
      id: "product-master",
      title: "상품 마스터",
      navigationLabel: "상품 마스터",
      description: "상품코드와 모델명을 한곳에서 관리합니다.",
      category: "상품 출시",
      inputType: "B-코드",
      outputType: "상품 기준정보",
      status: "available",
      route: "/test",
      historySupport: false,
      externalProject: false,
      note: null,
    },
    {
      id: "keyword-engine",
      title: "콘텐츠 키워드 엔진",
      navigationLabel: "키워드 엔진",
      description: "검색어를 정리합니다.",
      category: "콘텐츠·키워드",
      inputType: "자연어",
      outputType: "키워드",
      status: "available",
      route: "/test",
      historySupport: false,
      externalProject: false,
      note: null,
    },
  ];

  assert.equal(rankWorkspaceModules(modules, "상품마스터")[0]?.id, "product-master");
  assert.equal(rankWorkspaceModules(modules, "상품-마스터")[0]?.id, "product-master");
  assert.equal(rankWorkspaceModules(modules, "콘텐츠키워드")[0]?.id, "keyword-engine");
});

test("dashboard includes search, favorites, recent use, task signals, and safe retry", () => {
  assert.match(dashboardSource, /기능·상품·작업 통합 검색/);
  assert.match(dashboardSource, /자주 사용하는 기능/);
  assert.match(dashboardSource, /최근 사용/);
  assert.match(dashboardSource, /지금 확인할 항목/);
  assert.match(dashboardSource, /입력 복원 후 재실행/);
  assert.match(dashboardSource, /commerce-os-product-launch-tracker:v2/);
  assert.match(retrySource, /실패 작업의 입력값을 복원했습니다/);
  assert.match(retrySource, /goodsKey: "goods_key"/);
});

test("sidebar only exposes dashboard and six workspaces instead of every module", () => {
  assert.match(sidebarSource, /OPS_WORKSPACE_GROUPS\.map/);
  assert.doesNotMatch(sidebarSource, /extendedModuleRegistry\.flatMap/);
  assert.match(sidebarSource, /업무 영역/);
});
