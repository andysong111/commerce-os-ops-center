export type ModuleStatus = "available" | "preparing" | "disabled";

export type CommerceModule = {
  id: string;
  title: string;
  navigationLabel?: string;
  description: string;
  status: ModuleStatus;
  route: string | null;
  category: string;
  inputType: string;
  outputType: string;
  historySupport: boolean;
  externalProject: boolean;
  note: string | null;
};

export const moduleRegistry: readonly CommerceModule[] = [
  {
    id: "china-order-cost",
    title: "China Order Cost Calculator",
    navigationLabel: "중국주문 원가계산",
    description:
      "Allocates China domestic shipping costs by quantity for each freight group.",
    status: "available",
    route: "/china-orders",
    category: "Cost management",
    inputType: "Order and freight cost data",
    outputType: "Allocated product costs",
    historySupport: false,
    externalProject: false,
    note: null,
  },
  {
    id: "product-master",
    title: "Product Master",
    navigationLabel: "상품 마스터",
    description: "Manage products and option information in one place.",
    status: "available",
    route: "/product-master",
    category: "Product management",
    inputType: "Product and option data",
    outputType: "Product master records",
    historySupport: true,
    externalProject: false,
    note: null,
  },
  {
    id: "freight-barcode-pdf",
    title: "Freight Barcode PDF Generator",
    navigationLabel: "배대지 바코드 PDF 생성기",
    description:
      "Parses freight forwarding application text and creates barcode/origin label work request PDFs.",
    status: "available",
    route: "/freight-barcode-request",
    category: "Freight operations",
    inputType: "Freight forwarding application text",
    outputType: "Barcode/origin label work request PDF",
    historySupport: true,
    externalProject: false,
    note: "Uses the existing freight barcode request workflow.",
  },
  {
    id: "keyword-engine",
    title: "Keyword Engine",
    description: "Discovers and organizes search keywords by sales channel.",
    status: "preparing",
    route: null,
    category: "Sales content automation",
    inputType: "Product and sales channel data",
    outputType: "Organized keyword sets",
    historySupport: false,
    externalProject: true,
    note: "This is being developed separately in the keyword-engine-soon repository. Commerce OS should not execute it yet.",
  },
  {
    id: "keyword-review-queue",
    title: "Keyword Review Queue",
    navigationLabel: "키워드 검토 큐",
    description:
      "Review Keyword Engine MVP outputs, classify rows, and prepare safe manual approvals.",
    status: "available",
    route: "/keyword-review-queue",
    category: "keyword",
    inputType: "CSV/Markdown from keyword-engine-soon",
    outputType: "reviewed keyword approval data",
    historySupport: false,
    externalProject: true,
    note: "Initial review queue only. No live Shopling API execution. History support is future/planned.",
  },
  {
    id: "detail-page-engine",
    title: "Detail Page Engine",
    description:
      "Generates product detail page planning drafts and sales copy based on product information.",
    status: "preparing",
    route: null,
    category: "Sales content automation",
    inputType: "Product information",
    outputType: "Detail page plans and sales copy",
    historySupport: false,
    externalProject: true,
    note: "This is being developed separately in the product-detail-page-auto repository. Commerce OS should not execute it yet.",
  },
  {
    id: "inventory-price",
    title: "Inventory / Price Management",
    description: "Tracks stock quantities and channel-specific prices.",
    status: "preparing",
    route: null,
    category: "Inventory operations",
    inputType: "Inventory and channel price data",
    outputType: "Inventory and price status",
    historySupport: false,
    externalProject: false,
    note: "Available later.",
  },
  {
    id: "shopling-api-automation",
    title: "Shopling API Automation",
    description: "Automates repetitive sales channel operation tasks.",
    status: "preparing",
    route: null,
    category: "Channel automation",
    inputType: "Sales channel operation requests",
    outputType: "Automated operation results",
    historySupport: false,
    externalProject: false,
    note: "Available later.",
  },
];
