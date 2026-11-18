"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import {
  normalizeFreightImageUpstreamUrl,
  readFreightImageProxyUpstreamUrl,
  toFreightImageProxyUrl,
} from "@/lib/freightImageProxy";

const FREIGHT_BARCODE_ROUTE = "/freight-barcode-request";
const WORK_REQUEST_BUTTON_LABEL = "작업요청서 PDF ZIP 다운로드";
const FORWARDER_ZIP_BUTTON_LABEL = "배대지 전달용 개별 PDF ZIP 다운로드";
const SERVER_SAVE_BUTTON_LABEL = "서버 이력에 저장";
const IMAGE_PROXY_RETRY_ATTRIBUTE = "data-freight-image-proxy-retried";

function normalizeText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function findButtonByLabel(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => normalizeText(button.textContent) === label,
  );
}

function updateServerArchiveCopy() {
  const headings = Array.from(document.querySelectorAll<HTMLElement>("h3"));
  const serverHeading = headings.find(
    (heading) => normalizeText(heading.textContent) === "임시 서버 이력",
  );
  if (serverHeading) serverHeading.textContent = "서버 문서 보관함";

  const paragraphs = Array.from(document.querySelectorAll<HTMLParagraphElement>("p"));
  const temporaryCopy = paragraphs.find((paragraph) =>
    normalizeText(paragraph.textContent).includes(
      "서버가 재시작되면 사라지는 임시 저장소",
    ),
  );
  if (temporaryCopy) {
    temporaryCopy.textContent =
      "작업요청서 PDF ZIP 또는 배대지 전달용 개별 PDF ZIP을 다운로드하면 현재 작업이 서버에 자동 보관됩니다. 다시 열기로 언제든지 불러올 수 있습니다.";
  }

  const historyIntro = paragraphs.find((paragraph) =>
    normalizeText(paragraph.textContent).includes(
      "현재 작업을 임시 서버 이력에도 저장해 다시 열 수 있습니다",
    ),
  );
  if (historyIntro) {
    historyIntro.textContent =
      "기존 브라우저 로컬 이력은 그대로 유지됩니다. 문서 저장/다운로드 시 현재 작업이 서버 보관함에도 자동 저장되며, 필요하면 수동 저장도 사용할 수 있습니다.";
  }
}

function triggerServerArchiveSave() {
  const saveButton = findButtonByLabel(SERVER_SAVE_BUTTON_LABEL);
  if (!saveButton || saveButton.disabled) return;
  saveButton.click();
}

function currentImageSource(image: HTMLImageElement) {
  return image.currentSrc || image.getAttribute("src") || "";
}

function prepareExternalFreightImage(image: HTMLImageElement) {
  const source = currentImageSource(image);
  if (!normalizeFreightImageUpstreamUrl(source)) return;
  image.referrerPolicy = "no-referrer";
}

function prepareImageNode(node: Node) {
  if (node instanceof HTMLImageElement) {
    prepareExternalFreightImage(node);
    return;
  }
  if (!(node instanceof Element)) return;
  node
    .querySelectorAll<HTMLImageElement>("img")
    .forEach(prepareExternalFreightImage);
}

function retryBlockedFreightImage(event: Event) {
  const image = event.target instanceof HTMLImageElement ? event.target : null;
  if (!image) return;
  if (image.hasAttribute(IMAGE_PROXY_RETRY_ATTRIBUTE)) return;

  const source = currentImageSource(image);
  if (!source || readFreightImageProxyUpstreamUrl(source)) return;
  const proxyUrl = toFreightImageProxyUrl(source);
  if (!proxyUrl) return;

  // React's target-level onError would otherwise mark the candidate as failed
  // before the safe same-origin proxy retry gets a chance to load.
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  image.setAttribute(IMAGE_PROXY_RETRY_ATTRIBUTE, "1");
  image.referrerPolicy = "no-referrer";
  image.removeAttribute("srcset");
  image.removeAttribute("sizes");
  image.src = proxyUrl;
}

export function FreightBarcodePrintEnhancer() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== FREIGHT_BARCODE_ROUTE) return;

    updateServerArchiveCopy();
    document
      .querySelectorAll<HTMLImageElement>("img")
      .forEach(prepareExternalFreightImage);

    const imageObserver = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes") {
          prepareImageNode(record.target);
          continue;
        }
        record.addedNodes.forEach(prepareImageNode);
      }
    });
    imageObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["src", "srcset"],
    });

    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest<HTMLButtonElement>("button");
      if (!button) return;

      const label = normalizeText(button.textContent);
      if (label === WORK_REQUEST_BUTTON_LABEL) {
        triggerServerArchiveSave();
        return;
      }

      if (label === FORWARDER_ZIP_BUTTON_LABEL) {
        triggerServerArchiveSave();
      }
    };

    document.addEventListener("error", retryBlockedFreightImage, true);
    document.addEventListener("click", handleClick, true);

    return () => {
      imageObserver.disconnect();
      document.removeEventListener("error", retryBlockedFreightImage, true);
      document.removeEventListener("click", handleClick, true);
    };
  }, [pathname]);

  return null;
}
