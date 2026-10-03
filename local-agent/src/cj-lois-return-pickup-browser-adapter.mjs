import {
  listChromeTargets,
  withBrowserCdpTarget,
} from "./chrome-cdp.mjs";

const CJ_LOIS_ORIGIN = "https://loisparcelp.cjlogistics.com/";
const CJ_MAIN_APP_ID = "app/com/main/CMCMLI0002M";
const CJ_RESERVATION_APP_ID = "app/delivery/core/reservation/accept/DCRVAP1003M";
const CJ_RESERVATION_MENU_VALUE = "MENU-DC001148";
const CJ_RESERVATION_ENTRY_VALUE = "MENU-DC001149";
const CJ_SAVE_CONFIRMATION = "저장하시겠습니까?";
const CJ_DUPLICATE_RESERVATION = "선택하신 원운송장번호로 반품접수가 등록되어 있습니다.";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_NAVIGATION_TIMEOUT_MS = 20_000;
const SUCCESS_EVIDENCE = Object.freeze([
  "SAVE_DIALOG_CLOSED",
  "ORIGINAL_INVOICE_FIELD_RESET",
  "RESERVATION_GRID_ROW_APPENDED",
]);
const EXISTING_RESERVATION_EVIDENCE = Object.freeze([
  "DUPLICATE_RESERVATION_DIALOG_VERIFIED",
]);

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function digits(value) {
  return clean(value).replace(/\D/g, "");
}

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function cjLoisPageProbe() {
  const instances = window.cpr?.core?.Platform?.INSTANCE?.getAllRunningAppInstances?.() || [];
  const apps = instances.filter((instance) => instance.app?.id
    === "app/delivery/core/reservation/accept/DCRVAP1003M");
  const app = apps[0];
  const titleChildren = app?.lookup("title")?.getAllRecursiveChildren?.() || [];
  const saveControls = titleChildren.filter((control) => control.getEmbeddedAppInstance?.()?.app?.id
    === "udc/com/udcComButton"
    && (control?._eventListenerList?.save || []).length === 1);
  return {
    isReservationPage: apps.length === 1
      && Boolean(app.lookup("strOgnWblNo"))
      && Boolean(app.lookup("rdbRsvt"))
      && Boolean(app.lookup("dsGrdList"))
      && saveControls.length === 1,
    readyState: document.readyState,
    appCount: apps.length,
    invoiceInputCount: app?.lookup("strOgnWblNo") ? 1 : 0,
    saveButtonCount: saveControls.length,
    returnRadioCount: app?.lookup("rdbRsvt") ? 1 : 0,
  };
}

function cjLoisNavigationProbe() {
  const instances = window.cpr?.core?.Platform?.INSTANCE?.getAllRunningAppInstances?.() || [];
  const apps = instances.filter((instance) => instance.app?.id === "app/com/main/CMCMLI0002M");
  const app = apps[0];
  const dataSet = app?.lookup("dsMenuList");
  const sideMenu = app?.lookup("sdnMenu");
  const matchingRows = (predicate) => {
    const rows = [];
    for (let index = 0; index < (dataSet?.getRowCount?.() || 0); index += 1) {
      const row = dataSet.getRowData(index);
      if (predicate(row)) rows.push(row);
    }
    return rows;
  };
  const menuRows = matchingRows((row) => row.value === "MENU-DC001148"
    && row.label === "예약" && !row.appId);
  const entryRows = matchingRows((row) => row.value === "MENU-DC001149"
    && row.parent === "MENU-DC001148"
    && row.pgmId === "DCRVAP1003M"
    && row.appId === "app/delivery/core/reservation/accept/DCRVAP1003M");
  const menuItem = sideMenu?.getItemByValue?.("MENU-DC001148");
  return {
    authenticated: apps.length === 1,
    reservationMenuCount: menuRows.length === 1 && menuItem ? 1 : 0,
    reservationEntryCount: entryRows.length === 1
      && sideMenu?.isExpanded?.(menuItem) === true ? 1 : 0,
    readyState: document.readyState,
  };
}

function clickExactCjLoisNavigationLabel(label) {
  const instances = window.cpr?.core?.Platform?.INSTANCE?.getAllRunningAppInstances?.() || [];
  const apps = instances.filter((instance) => instance.app?.id === "app/com/main/CMCMLI0002M");
  if (apps.length !== 1) return { error: "CJ_MAIN_APP_COUNT_INVALID", count: apps.length };
  const app = apps[0];
  const sideMenu = app.lookup("sdnMenu");
  const menu = sideMenu?.getItemByValue?.("MENU-DC001148");
  const entry = sideMenu?.getItemByValue?.("MENU-DC001149");
  if (!menu || !entry) return { error: "CJ_NAVIGATION_ITEM_MISSING", label };
  if (label === "예약") {
    sideMenu.expandItem(menu);
    return { clicked: sideMenu.isExpanded(menu) === true, label };
  }
  if (label !== "기업고객건별접수") {
    return { error: "CJ_NAVIGATION_LABEL_UNEXPECTED", label };
  }
  sideMenu.expandItem(menu);
  sideMenu.revealItem(entry);
  const listeners = sideMenu?._eventListenerList?.["item-click"] || [];
  if (listeners.length !== 1 || typeof listeners[0] !== "function") {
    return { error: "CJ_NAVIGATION_LISTENER_COUNT_INVALID", count: listeners.length };
  }
  listeners[0]({ control: sideMenu, item: entry });
  return { clicked: true, label };
}

function captureCjLoisSafeSnapshot() {
  const instances = window.cpr?.core?.Platform?.INSTANCE?.getAllRunningAppInstances?.() || [];
  const apps = instances.filter((instance) => instance.app?.id
    === "app/delivery/core/reservation/accept/DCRVAP1003M");
  const app = apps[0];
  const invoice = app?.lookup("strOgnWblNo");
  const returnRadio = app?.lookup("rdbRsvt");
  const product = app?.lookup("itmlNm");
  const amountMap = app?.lookup("dmAmt");
  const dataSet = app?.lookup("dsGrdList");
  const lookupDataSet = app?.lookup("dsSndrRcvrInfo");
  const originalInfo = app?.lookup("dmOgnWblNoInfo");
  const titleChildren = app?.lookup("title")?.getAllRecursiveChildren?.() || [];
  const saveControls = titleChildren.filter((control) => control.getEmbeddedAppInstance?.()?.app?.id
    === "udc/com/udcComButton"
    && (control?._eventListenerList?.save || []).length === 1);
  const rows = [];
  for (let index = 0; index < (dataSet?.getRowCount?.() || 0); index += 1) {
    rows.push(dataSet.getRowData(index));
  }
  const completedRows = rows.filter((row) => String(row.rsvtNo || "").trim().length > 0);
  const draftRows = rows.filter((row) => String(row.rsvtNo || "").trim().length === 0);
  const originalInvoiceDigits = String(invoice?.value || "").replace(/\D/g, "");
  const requiredLookupControls = [
    "sndrCustNm",
    "sndrZip",
    "sndrBscAddr",
    "rcvrCustCd",
    "rcvrCustNm",
    "rcvrBscAddr",
    "strCustMngPrnctnCd",
  ]
    .map((id) => app?.lookup(id));
  const senderPhoneReady = ["sndrTelNo1", "sndrTelNo2", "sndrTelNo3"]
    .map((id) => String(app?.lookup(id)?.value || "").trim())
    .every(Boolean)
    || ["sndrClphNo1", "sndrClphNo2", "sndrClphNo3"]
      .map((id) => String(app?.lookup(id)?.value || "").trim())
      .every(Boolean);
  const originalPhoneReady = ["rcvrLareaTelno", "rcvrTonoTelno", "rcvrIndvTelno"]
    .map((id) => String(originalInfo?.getValue?.(id) || "").trim())
    .every(Boolean)
    || ["rcvrFs1Clphno", "rcvrSc2Clphno", "rcvrTh3Clphno"]
      .map((id) => String(originalInfo?.getValue?.(id) || "").trim())
      .every(Boolean);
  const originalInfoReady = ["rcvrNm", "rcvrZip", "rcvrAddr", "rcvrDtlAddr"]
    .every((id) => String(originalInfo?.getValue?.(id) || "").trim().length > 0)
    && originalPhoneReady;
  const lookupReady = lookupDataSet?.getRowCount?.() === 1
    && requiredLookupControls.every((control) => String(control?.value || "").trim().length > 0)
    && senderPhoneReady;
  const productReady = String(product?.value || "").trim().length > 0;
  const activeDraft = draftRows.length === 1 ? draftRows[0] : null;
  const formReady = productReady
    && Number(activeDraft?.bscFareSum || 0) > 0
    && Number(activeDraft?.fareSumAmt || 0) > 0
    && String(activeDraft?.itmlNm || "").trim().length > 0
    && Number(activeDraft?.qtySum || 0) === 1
    && String(activeDraft?.boxTypCd || "") === "1";
  const fareLookupReady = String(amountMap?.getValue?.("resultCd") || "") === "0"
    && Number(amountMap?.getValue?.("bscFareAmt") || 0) > 0;
  return {
    isReservationPage: apps.length === 1
      && Boolean(invoice && returnRadio && dataSet)
      && saveControls.length === 1,
    readyState: document.readyState,
    originalInvoiceDigits,
    reservationTypeReturn: String(returnRadio?.value || "") === "02",
    lookupReady,
    originalInfoReady,
    productReady,
    fareLookupReady,
    formReady,
    saveButtonCount: saveControls.length,
    totalGridRowCount: rows.length,
    draftReservationRowCount: draftRows.length,
    completedReservationRowCount: completedRows.length,
    originalInvoiceFieldReset: originalInvoiceDigits.length === 0,
  };
}

function prepareOriginalInvoiceField(invoiceNo) {
  const instances = window.cpr?.core?.Platform?.INSTANCE?.getAllRunningAppInstances?.() || [];
  const apps = instances.filter((instance) => instance.app?.id
    === "app/delivery/core/reservation/accept/DCRVAP1003M");
  if (apps.length !== 1) return { error: "CJ_RESERVATION_APP_COUNT_INVALID", count: apps.length };
  const app = apps[0];
  const input = app.lookup("strOgnWblNo");
  const radio = app.lookup("rdbRsvt");
  if (!input) return { error: "CJ_ORIGINAL_INVOICE_INPUT_COUNT_INVALID", count: 0 };
  if (!radio) return { error: "CJ_RETURN_RADIO_COUNT_INVALID", count: 0 };
  const items = radio.getItems?.() || [];
  const returnIndex = items.findIndex((item) => item.value === "02" && item.label === "반품");
  if (returnIndex < 0) return { error: "CJ_RETURN_RADIO_ITEM_MISSING" };
  const returnWasSelected = String(radio.value || "") === "02";
  if (!returnWasSelected) radio.selectItem(returnIndex);
  const activeInput = app.lookup("strOgnWblNo");
  activeInput.value = String(invoiceNo || "");
  activeInput.redraw?.();
  const params = app.lookup("dmParam");
  if (!params) return { error: "CJ_ORIGINAL_INVOICE_PARAMS_MISSING" };
  params.setValue("strOgnWblNo", String(invoiceNo || ""));
  activeInput.focus();
  const submission = app.lookup("smsOgnWblNoInfo");
  if (!submission || typeof submission.send !== "function") {
    return { error: "CJ_ORIGINAL_INVOICE_SUBMISSION_MISSING" };
  }
  submission.send();
  return {
    prepared: true,
    focused: true,
    lookupRequested: true,
    reservationTypeReturn: String(radio.value || "") === "02",
    requestedInvoiceLength: String(invoiceNo || "").length,
  };
}

function applyOriginalRecipientAsSender() {
  const instances = window.cpr?.core?.Platform?.INSTANCE?.getAllRunningAppInstances?.() || [];
  const apps = instances.filter((instance) => instance.app?.id
    === "app/delivery/core/reservation/accept/DCRVAP1003M");
  if (apps.length !== 1) return { error: "CJ_RESERVATION_APP_COUNT_INVALID", count: apps.length };
  const app = apps[0];
  const info = app.lookup("dmOgnWblNoInfo");
  const dataSet = app.lookup("dsGrdList");
  const row = dataSet?.getRowData?.(0);
  if (!info || !row) return { error: "CJ_ORIGINAL_INVOICE_DATA_MISSING" };
  const values = {
    sndrCustCd: info.getValue("rcvrCustCd") || "0000000000",
    sndrCustNm: info.getValue("rcvrNm"),
    sndrTelNo1: info.getValue("rcvrLareaTelno"),
    sndrTelNo2: info.getValue("rcvrTonoTelno"),
    sndrTelNo3: info.getValue("rcvrIndvTelno"),
    sndrClphNo1: info.getValue("rcvrFs1Clphno"),
    sndrClphNo2: info.getValue("rcvrSc2Clphno"),
    sndrClphNo3: info.getValue("rcvrTh3Clphno"),
    sndrZip: info.getValue("rcvrZip"),
    sndrBscAddr: info.getValue("rcvrAddr"),
    sndrDtlAddr: info.getValue("rcvrDtlAddr"),
  };
  const phoneReady = [values.sndrTelNo1, values.sndrTelNo2, values.sndrTelNo3].every(Boolean)
    || [values.sndrClphNo1, values.sndrClphNo2, values.sndrClphNo3].every(Boolean);
  if (![values.sndrCustNm, values.sndrZip, values.sndrBscAddr, values.sndrDtlAddr].every(Boolean)
    || !phoneReady) return { error: "CJ_ORIGINAL_RECIPIENT_INCOMPLETE" };
  for (const [id, value] of Object.entries(values)) {
    const control = app.lookup(id);
    if (!control) return { error: "CJ_SENDER_CONTROL_MISSING", id };
    control.value = String(value || "");
    control.redraw?.();
  }
  const selected = app.lookup("grdList")?.getSelectedRow?.();
  if (!selected) return { error: "CJ_RESERVATION_ROW_MISSING" };
  const rowValues = {
    sndrCustCd: values.sndrCustCd,
    sndrNm: values.sndrCustNm,
    sndrLareaTelno: values.sndrTelNo1,
    sndrTonoTelno: values.sndrTelNo2,
    sndrIndvTelno: values.sndrTelNo3,
    sndrFs1Clphno: values.sndrClphNo1,
    sndrSc2Clphno: values.sndrClphNo2,
    sndrTh3Clphno: values.sndrClphNo3,
    sndrZip: values.sndrZip,
    sndrZipSn: info.getValue("rcvrZipSn"),
    sndrBscAddr: values.sndrBscAddr,
    sndrDtlAddr: values.sndrDtlAddr,
  };
  for (const [name, value] of Object.entries(rowValues)) selected.setValue(name, String(value || ""));
  return { applied: true };
}

function prepareReturnFormFields(productName) {
  const instances = window.cpr?.core?.Platform?.INSTANCE?.getAllRunningAppInstances?.() || [];
  const apps = instances.filter((instance) => instance.app?.id
    === "app/delivery/core/reservation/accept/DCRVAP1003M");
  if (apps.length !== 1) return { error: "CJ_RESERVATION_APP_COUNT_INVALID", count: apps.length };
  const app = apps[0];
  const itemCategory = app.lookup("cmbItml");
  const itemName = app.lookup("itmlNm");
  const boxType = app.lookup("cmbBoxType");
  const boxQuantity = app.lookup("boxQty");
  const amountMap = app.lookup("dmAmt");
  const amountSubmission = app.lookup("smsAmt");
  if (!itemCategory || !itemName || !boxType || !boxQuantity) {
    return { error: "CJ_RETURN_FORM_CONTROL_MISSING" };
  }
  if (!amountMap || !amountSubmission || typeof amountSubmission.send !== "function") {
    return { error: "CJ_FARE_SUBMISSION_MISSING" };
  }
  const normalizedProductName = String(productName || "").replace(/\s+/g, " ").trim();
  if (!normalizedProductName || normalizedProductName.length > 200) {
    return { error: "CJ_RETURN_PRODUCT_NAME_INVALID" };
  }
  const itemIndex = (itemCategory.getItems?.() || [])
    .findIndex((candidate) => candidate.value === "04" && candidate.label === "04-제품");
  const boxIndex = (boxType.getItems?.() || [])
    .findIndex((candidate) => candidate.value === "1" && candidate.label === "1-극소");
  if (itemIndex < 0 || boxIndex < 0) return { error: "CJ_RETURN_FORM_OPTION_MISSING" };
  itemCategory.selectItem(itemIndex);
  itemName.value = normalizedProductName;
  itemName.redraw?.();
  boxQuantity.value = "1";
  boxQuantity.redraw?.();
  boxType.selectItem(boxIndex);
  const originalParty = app.lookup("dsSndrRcvrInfo")?.getRowData?.(0) || {};
  const draft = app.lookup("dsGrdList")?.getRowData?.(0) || {};
  const addressParams = app.lookup("dmParam");
  const contractParams = app.lookup("dmCmb");
  const fareFields = {
    inCustCd: contractParams?.getValue?.("custCd") || originalParty.custCd,
    inCustMngPrnctnCd: contractParams?.getValue?.("custMngPrnctnCd"),
    inFareRageDiv: draft.fareRageDcd,
    inRsvtDcd: draft.rsvtDcd,
    inFareDiv: draft.fareDcd,
    inDlvsGoodsCd: draft.dlvsGoodsCd,
    inCntrItmlCd: draft.cntrItmlCd,
    inBoxTypCd: draft.boxTypCd,
    inXrgDcd: app.lookup("rdbAdjpl")?.value,
    inSndrZip: originalParty.zip,
    inSndrZipSn: "",
    inRcvrZip: addressParams?.getValue?.("strZip"),
    inRcvrZipSn: addressParams?.getValue?.("strZipSn"),
  };
  const requiredFareFields = Object.entries(fareFields)
    .filter(([name]) => name !== "inSndrZipSn");
  if (requiredFareFields.some(([, value]) => !String(value || "").trim())) {
    return { error: "CJ_FARE_INPUT_INCOMPLETE" };
  }
  for (const [name, value] of Object.entries(fareFields)) {
    amountMap.setValue(name, String(value || ""));
  }
  amountSubmission.send();
  return {
    prepared: true,
    fareLookupRequested: true,
    itemCategory: String(itemCategory.value || ""),
    boxType: String(boxType.value || ""),
    boxQuantity: String(boxQuantity.value || ""),
  };
}

function applyReturnFareResult() {
  const instances = window.cpr?.core?.Platform?.INSTANCE?.getAllRunningAppInstances?.() || [];
  const apps = instances.filter((instance) => instance.app?.id
    === "app/delivery/core/reservation/accept/DCRVAP1003M");
  if (apps.length !== 1) return { error: "CJ_RESERVATION_APP_COUNT_INVALID", count: apps.length };
  const app = apps[0];
  const amountMap = app.lookup("dmAmt");
  const baseFare = app.lookup("bscFare");
  const boxQuantity = Number(app.lookup("boxQty")?.value || 0);
  const unitFare = Number(amountMap?.getValue?.("bscFareAmt") || 0);
  if (String(amountMap?.getValue?.("resultCd") || "") !== "0" || unitFare <= 0 || boxQuantity <= 0) {
    return { error: "CJ_FARE_LOOKUP_INCOMPLETE" };
  }
  const calculatedFare = String(unitFare * boxQuantity);
  const oldValue = String(baseFare?.value || "");
  if (!baseFare) return { error: "CJ_BASE_FARE_CONTROL_MISSING" };
  baseFare.value = calculatedFare;
  baseFare.redraw?.();
  const listeners = baseFare?._eventListenerList?.["value-change"] || [];
  if (listeners.length !== 1 || typeof listeners[0] !== "function") {
    return { error: "CJ_BASE_FARE_LISTENER_COUNT_INVALID", count: listeners.length };
  }
  listeners[0]({ control: baseFare, oldValue, newValue: calculatedFare });
  return { applied: true, calculatedFare };
}

function focusOriginalInvoiceField() {
  const instances = window.cpr?.core?.Platform?.INSTANCE?.getAllRunningAppInstances?.() || [];
  const apps = instances.filter((instance) => instance.app?.id
    === "app/delivery/core/reservation/accept/DCRVAP1003M");
  if (apps.length !== 1) return { error: "CJ_RESERVATION_APP_COUNT_INVALID", count: apps.length };
  const input = apps[0].lookup("strOgnWblNo");
  if (!input) return { error: "CJ_ORIGINAL_INVOICE_INPUT_COUNT_INVALID", count: 0 };
  input.focus();
  return { focused: true };
}

function clickCjLoisSave() {
  const instances = window.cpr?.core?.Platform?.INSTANCE?.getAllRunningAppInstances?.() || [];
  const apps = instances.filter((instance) => instance.app?.id
    === "app/delivery/core/reservation/accept/DCRVAP1003M");
  if (apps.length !== 1) return { error: "CJ_RESERVATION_APP_COUNT_INVALID", count: apps.length };
  const controls = apps[0].lookup("title")?.getAllRecursiveChildren?.() || [];
  const buttons = controls.filter((control) => control.getEmbeddedAppInstance?.()?.app?.id
    === "udc/com/udcComButton"
    && (control?._eventListenerList?.save || []).length === 1);
  if (buttons.length !== 1) return { error: "CJ_SAVE_BUTTON_COUNT_INVALID", count: buttons.length };
  const saveButton = buttons[0].getEmbeddedAppInstance()?.lookup("btnSave");
  if (!saveButton || typeof saveButton.click !== "function") {
    return { error: "CJ_SAVE_INNER_BUTTON_MISSING" };
  }
  saveButton.click();
  return { clicked: true };
}

export const CJ_LOIS_PAGE_PROBE_EXPRESSION = `(${cjLoisPageProbe.toString()})()`;
export const CJ_LOIS_NAVIGATION_PROBE_EXPRESSION = `(${cjLoisNavigationProbe.toString()})()`;
export const CJ_LOIS_CLICK_RESERVATION_MENU_EXPRESSION = `(${clickExactCjLoisNavigationLabel.toString()})("예약")`;
export const CJ_LOIS_CLICK_RESERVATION_ENTRY_EXPRESSION = `(${clickExactCjLoisNavigationLabel.toString()})("기업고객건별접수")`;
export const CJ_LOIS_SAFE_SNAPSHOT_EXPRESSION = `(${captureCjLoisSafeSnapshot.toString()})()`;
export const CJ_LOIS_PREPARE_INVOICE_SOURCE = prepareOriginalInvoiceField.toString();
export const CJ_LOIS_PREPARE_INVOICE_EXPRESSION = `(${prepareOriginalInvoiceField.toString()})("")`;
export const CJ_LOIS_APPLY_SENDER_EXPRESSION = `(${applyOriginalRecipientAsSender.toString()})()`;
export const CJ_LOIS_PREPARE_FORM_SOURCE = prepareReturnFormFields.toString();
export const CJ_LOIS_APPLY_FARE_EXPRESSION = `(${applyReturnFareResult.toString()})()`;
export const CJ_LOIS_FOCUS_INVOICE_EXPRESSION = `(${focusOriginalInvoiceField.toString()})()`;
export const CJ_LOIS_CLICK_SAVE_EXPRESSION = `(${clickCjLoisSave.toString()})()`;

export function isExpectedCjLoisSaveDialog(dialog = {}) {
  return ["confirm", "cpr-modal"].includes(dialog.type)
    && clean(dialog.message) === CJ_SAVE_CONFIRMATION;
}

function probeCjLoisSaveModal() {
  const instances = window.cpr?.core?.Platform?.INSTANCE?.getAllRunningAppInstances?.() || [];
  const modals = instances.filter((instance) => instance.app?.id === "app/cmn/Modal");
  const dialogs = modals.map((instance) => ({
    message: String(instance.lookup("optMsg")?.value || "").replace(/\s+/g, " ").trim(),
    confirmReady: Boolean(instance.lookup("btnConfirm")),
    cancelReady: Boolean(instance.lookup("btnCancel")),
  }));
  const expected = dialogs.filter((dialog) => dialog.message === "저장하시겠습니까?"
    && dialog.confirmReady);
  const visibleDomDialogs = [...document.querySelectorAll(".cl-dialog")]
    .map((dialog) => {
      const rect = dialog.getBoundingClientRect();
      return {
        visible: rect.width > 0 && rect.height > 0,
        message: String(dialog.innerText || "").replace(/\s+/g, " ").trim(),
      };
    }).filter((dialog) => dialog.visible);
  const duplicates = visibleDomDialogs.filter((dialog) => dialog.message
    .includes("선택하신 원운송장번호로 반품접수가 등록되어 있습니다."));
  return {
    modalCount: modals.length,
    expectedCount: expected.length,
    duplicateCount: duplicates.length,
    messages: [
      ...dialogs.map((dialog) => dialog.message),
      ...visibleDomDialogs.map((dialog) => dialog.message),
    ],
  };
}

function locateDuplicateReservationConfirm() {
  const matches = [...document.querySelectorAll(".cl-dialog")].filter((dialog) => {
    const rect = dialog.getBoundingClientRect();
    const text = String(dialog.innerText || "").replace(/\s+/g, " ").trim();
    return rect.width > 0 && rect.height > 0
      && text.includes("선택하신 원운송장번호로 반품접수가 등록되어 있습니다.");
  });
  if (matches.length !== 1) return { error: "CJ_DUPLICATE_DIALOG_COUNT_INVALID", count: matches.length };
  const label = [...matches[0].querySelectorAll(".cl-text-wrapper")]
    .find((element) => String(element.innerText || "").replace(/\s+/g, " ").trim() === "확인");
  const button = label?.closest?.(".cl-button") || label;
  const rect = button?.getBoundingClientRect?.();
  if (!rect || rect.width <= 0 || rect.height <= 0) return { error: "CJ_DUPLICATE_CONFIRM_MISSING" };
  return { x: rect.left + (rect.width / 2), y: rect.top + (rect.height / 2) };
}

function confirmCjLoisSaveModal() {
  const instances = window.cpr?.core?.Platform?.INSTANCE?.getAllRunningAppInstances?.() || [];
  const modals = instances.filter((instance) => instance.app?.id === "app/cmn/Modal"
    && String(instance.lookup("optMsg")?.value || "").replace(/\s+/g, " ").trim()
      === "저장하시겠습니까?");
  if (modals.length !== 1) return { error: "CJ_SAVE_MODAL_COUNT_INVALID", count: modals.length };
  const confirm = modals[0].lookup("btnConfirm");
  if (!confirm) return { error: "CJ_SAVE_MODAL_CONFIRM_MISSING" };
  confirm.click();
  return { clicked: true };
}

export const CJ_LOIS_SAVE_MODAL_PROBE_EXPRESSION = `(${probeCjLoisSaveModal.toString()})()`;
export const CJ_LOIS_CONFIRM_SAVE_MODAL_EXPRESSION = `(${confirmCjLoisSaveModal.toString()})()`;
export const CJ_LOIS_DUPLICATE_CONFIRM_POINT_EXPRESSION = `(${locateDuplicateReservationConfirm.toString()})()`;

export async function acceptExpectedCjLoisSaveDialog(session, trigger, options = {}) {
  if (typeof session?.send !== "function") fail("CDP_DIALOG_SESSION_INVALID", "A CDP session is required.");
  if (typeof trigger !== "function") fail("CDP_DIALOG_TRIGGER_REQUIRED", "A dialog trigger is required.");
  const timeoutMs = options.timeoutMs || 8_000;
  const pollMs = options.pollMs || 100;
  await trigger();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const evaluated = await session.send("Runtime.evaluate", {
      expression: CJ_LOIS_SAVE_MODAL_PROBE_EXPRESSION,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    }, timeoutMs);
    const modal = evaluated.result?.value;
    if (modal?.expectedCount === 1 && modal.modalCount === 1) {
      const confirmed = await session.send("Runtime.evaluate", {
        expression: CJ_LOIS_CONFIRM_SAVE_MODAL_EXPRESSION,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
      }, timeoutMs).then((result) => result.result?.value);
      if (confirmed?.error || !confirmed?.clicked) {
        fail(confirmed?.error || "CJ_SAVE_MODAL_CONFIRM_FAILED", "CJ save confirmation could not be accepted.");
      }
      return { accepted: true, messageVerified: true, type: "cpr-modal" };
    }
    if (modal?.duplicateCount === 1 && modal?.expectedCount === 0) {
      const located = await session.send("Runtime.evaluate", {
        expression: CJ_LOIS_DUPLICATE_CONFIRM_POINT_EXPRESSION,
        returnByValue: true,
        awaitPromise: true,
      }, timeoutMs).then((result) => result.result?.value);
      if (located?.error || !Number.isFinite(located?.x) || !Number.isFinite(located?.y)) {
        fail(located?.error || "CJ_DUPLICATE_CONFIRM_MISSING", "CJ duplicate-reservation dialog could not be dismissed.");
      }
      await session.send("Page.bringToFront", {}, timeoutMs);
      await session.send("Input.dispatchMouseEvent", {
        type: "mousePressed", x: located.x, y: located.y, button: "left", buttons: 1, clickCount: 1,
      }, timeoutMs);
      await session.send("Input.dispatchMouseEvent", {
        type: "mouseReleased", x: located.x, y: located.y, button: "left", buttons: 0, clickCount: 1,
      }, timeoutMs);
      return {
        accepted: false,
        alreadyRegistered: true,
        messageVerified: true,
        message: CJ_DUPLICATE_RESERVATION,
        type: "cpr-modal",
      };
    }
    if (modal?.modalCount > 0 && modal?.expectedCount !== 1) {
      fail("CJ_SAVE_DIALOG_UNEXPECTED", "An unexpected CJ dialog was refused.", {
        messages: modal.messages || [],
      });
    }
    await sleep(pollMs);
  }
  fail("CJ_SAVE_DIALOG_TIMEOUT", "CJ save confirmation did not appear.");
}

export function selectCjLoisReservationFrame(results = []) {
  const matches = results.filter((entry) => entry?.value?.isReservationPage === true);
  if (matches.length !== 1) {
    fail("CJ_RESERVATION_FRAME_COUNT_INVALID", "Exactly one CJ reservation frame is required.", {
      matchCount: matches.length,
    });
  }
  return matches[0];
}

async function evaluateInFrame(session, frame, expression, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!frame?.id) {
    const result = await session.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    }, timeoutMs);
    if (result.exceptionDetails) fail("CJ_FRAME_EVALUATION_FAILED", "CJ page evaluation failed.");
    return result.result?.value;
  }
  const world = await session.send("Page.createIsolatedWorld", {
    frameId: frame.id,
    worldName: "commerce-os-cj-return-pickup",
    grantUniveralAccess: false,
  }, timeoutMs);
  const result = await session.send("Runtime.evaluate", {
    expression,
    contextId: world.executionContextId,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  }, timeoutMs);
  if (result.exceptionDetails) fail("CJ_FRAME_EVALUATION_FAILED", "CJ page evaluation failed.");
  return result.result?.value;
}

async function evaluateCjExpression(session, expression, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const result = await session.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  }, timeoutMs);
  if (result.exceptionDetails) fail("CJ_PAGE_EVALUATION_FAILED", "CJ page evaluation failed.");
  return [{
    frame: { id: "", parentId: "", name: "", url: "", depth: 0 },
    value: result.result?.value,
  }];
}

async function findReservationFrame(session, dependencies, timeoutMs) {
  const evaluateAcross = dependencies.evaluateAcrossFrames || evaluateCjExpression;
  const results = await evaluateAcross(session, CJ_LOIS_PAGE_PROBE_EXPRESSION, { timeoutMs });
  return selectCjLoisReservationFrame(results);
}

async function findReservationFrameIfPresent(session, dependencies, timeoutMs) {
  const evaluateAcross = dependencies.evaluateAcrossFrames || evaluateCjExpression;
  const results = await evaluateAcross(session, CJ_LOIS_PAGE_PROBE_EXPRESSION, { timeoutMs });
  const matches = results.filter((entry) => entry?.value?.isReservationPage === true);
  if (matches.length > 1) {
    fail("CJ_RESERVATION_FRAME_COUNT_INVALID", "Exactly one CJ reservation frame is required.", {
      matchCount: matches.length,
    });
  }
  return matches[0] || null;
}

async function clickUniqueNavigationLabel(session, probeKey, expression, dependencies, timeoutMs) {
  const evaluateAcross = dependencies.evaluateAcrossFrames || evaluateCjExpression;
  const evaluateFrame = dependencies.evaluateInFrame || evaluateInFrame;
  const results = await evaluateAcross(session, CJ_LOIS_NAVIGATION_PROBE_EXPRESSION, { timeoutMs });
  const matches = results.filter((entry) => entry?.value?.[probeKey] === 1);
  if (matches.length !== 1) {
    fail("CJ_NAVIGATION_TARGET_COUNT_INVALID", "CJ navigation target must be unique.", {
      probeKey,
      matchCount: matches.length,
    });
  }
  if (!matches[0].value.authenticated) {
    fail("CJ_AUTHENTICATION_REQUIRED", "CJ LOIS must be authenticated before navigation.");
  }
  const clicked = await evaluateFrame(session, matches[0].frame, expression, timeoutMs);
  if (clicked?.error || !clicked?.clicked) {
    fail(clicked?.error || "CJ_NAVIGATION_CLICK_FAILED", "CJ navigation control could not be clicked.", clicked || {});
  }
}

export async function ensureCjLoisReservationPage(session, options = {}, dependencies = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const wait = dependencies.sleep || sleep;
  const deadline = Date.now() + (options.navigationTimeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS);
  let frame = await findReservationFrameIfPresent(session, dependencies, timeoutMs);
  if (frame) return { frame, navigated: false };

  const evaluateAcross = dependencies.evaluateAcrossFrames || evaluateCjExpression;
  let navigation = await evaluateAcross(session, CJ_LOIS_NAVIGATION_PROBE_EXPRESSION, { timeoutMs });
  let entryCount = navigation.reduce(
    (sum, entry) => sum + Number(entry?.value?.reservationEntryCount || 0),
    0,
  );
  if (entryCount === 0) {
    await clickUniqueNavigationLabel(
      session,
      "reservationMenuCount",
      CJ_LOIS_CLICK_RESERVATION_MENU_EXPRESSION,
      dependencies,
      timeoutMs,
    );
    while (Date.now() < deadline) {
      navigation = await evaluateAcross(session, CJ_LOIS_NAVIGATION_PROBE_EXPRESSION, { timeoutMs });
      entryCount = navigation.reduce(
        (sum, entry) => sum + Number(entry?.value?.reservationEntryCount || 0),
        0,
      );
      if (entryCount > 0) break;
      await wait(options.pollMs || 300);
    }
  }
  await clickUniqueNavigationLabel(
    session,
    "reservationEntryCount",
    CJ_LOIS_CLICK_RESERVATION_ENTRY_EXPRESSION,
    dependencies,
    timeoutMs,
  );
  while (Date.now() < deadline) {
    frame = await findReservationFrameIfPresent(session, dependencies, timeoutMs);
    if (frame) return { frame, navigated: true };
    await wait(options.pollMs || 300);
  }
  fail("CJ_RESERVATION_NAVIGATION_TIMEOUT", "CJ reservation page did not open after exact menu navigation.");
}

async function readSnapshot(session, frame, dependencies, timeoutMs) {
  const evaluateFrame = dependencies.evaluateInFrame || evaluateInFrame;
  const snapshot = await evaluateFrame(session, frame.frame, CJ_LOIS_SAFE_SNAPSHOT_EXPRESSION, timeoutMs);
  if (!snapshot?.isReservationPage) fail("CJ_RESERVATION_PAGE_CHANGED", "CJ reservation controls changed or disappeared.");
  return snapshot;
}

async function waitForPreparedState(session, frame, invoiceNo, dependencies, options) {
  const wait = dependencies.sleep || sleep;
  const deadline = Date.now() + (options.lookupTimeoutMs || 30_000);
  let lastSnapshot = null;
  while (Date.now() < deadline) {
    const snapshot = await readSnapshot(session, frame, dependencies, options.timeoutMs);
    lastSnapshot = snapshot;
    if (snapshot.originalInvoiceDigits === invoiceNo
      && snapshot.reservationTypeReturn
      && snapshot.lookupReady
      && snapshot.saveButtonCount === 1) return snapshot;
    await wait(options.pollMs || 300);
  }
  fail("CJ_RETURN_LOOKUP_TIMEOUT", "CJ did not finish loading the original shipment for return pickup.", {
    lastSnapshot,
  });
}

async function waitForOriginalInfoState(session, frame, dependencies, options) {
  const wait = dependencies.sleep || sleep;
  const deadline = Date.now() + (options.lookupTimeoutMs || 30_000);
  let lastSnapshot = null;
  while (Date.now() < deadline) {
    const snapshot = await readSnapshot(session, frame, dependencies, options.timeoutMs);
    lastSnapshot = snapshot;
    if ((snapshot.originalInfoReady || snapshot.lookupReady) && snapshot.saveButtonCount === 1) return snapshot;
    await wait(options.pollMs || 300);
  }
  fail("CJ_ORIGINAL_INFO_LOOKUP_TIMEOUT", "CJ did not return the original recipient for return pickup.", {
    lastSnapshot,
  });
}

async function waitForReturnFormState(session, frame, dependencies, options) {
  const wait = dependencies.sleep || sleep;
  const deadline = Date.now() + (options.formTimeoutMs || 30_000);
  let lastSnapshot = null;
  while (Date.now() < deadline) {
    const snapshot = await readSnapshot(session, frame, dependencies, options.timeoutMs);
    lastSnapshot = snapshot;
    if (snapshot.formReady && snapshot.saveButtonCount === 1) return snapshot;
    await wait(options.pollMs || 300);
  }
  fail("CJ_RETURN_FORM_PREPARATION_TIMEOUT", "CJ did not finish preparing required return fields.", {
    lastSnapshot,
  });
}

async function waitForFareLookupState(session, frame, dependencies, options) {
  const wait = dependencies.sleep || sleep;
  const deadline = Date.now() + (options.fareTimeoutMs || 30_000);
  let lastSnapshot = null;
  while (Date.now() < deadline) {
    const snapshot = await readSnapshot(session, frame, dependencies, options.timeoutMs);
    lastSnapshot = snapshot;
    if ((snapshot.fareLookupReady || snapshot.formReady) && snapshot.saveButtonCount === 1) return snapshot;
    await wait(options.pollMs || 300);
  }
  fail("CJ_FARE_LOOKUP_TIMEOUT", "CJ did not calculate the return pickup fare.", { lastSnapshot });
}

async function waitForSavedState(session, frame, before, dependencies, options) {
  const wait = dependencies.sleep || sleep;
  const deadline = Date.now() + (options.saveTimeoutMs || 30_000);
  while (Date.now() < deadline) {
    const snapshot = await readSnapshot(session, frame, dependencies, options.timeoutMs);
    if (snapshot.originalInvoiceFieldReset
      && snapshot.completedReservationRowCount > before.completedReservationRowCount) return snapshot;
    await wait(options.pollMs || 300);
  }
  fail("CJ_RETURN_PICKUP_READBACK_INCOMPLETE", "CJ did not show every required reservation success signal.");
}

export function createCjLoisReturnPickupBrowserAdapter(session, options = {}, dependencies = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const evaluateFrame = dependencies.evaluateInFrame || evaluateInFrame;
  const handleSaveDialog = dependencies.acceptSaveDialog || acceptExpectedCjLoisSaveDialog;
  const prepareReturnPickup = async (step = {}) => {
    const outboundInvoiceNo = digits(step.outboundInvoiceNo);
    const productName = clean(step.productName);
    if (!/^\d{10,14}$/.test(outboundInvoiceNo)) {
      fail("CJ_ORIGINAL_INVOICE_INVALID", "A 10-14 digit original invoice number is required.");
    }
    if (!productName || productName.length > 200) {
      fail("CJ_RETURN_PRODUCT_NAME_INVALID", "A reviewed product name is required for CJ return pickup.");
    }
    const frame = await findReservationFrame(session, dependencies, timeoutMs);
    const initial = await readSnapshot(session, frame, dependencies, timeoutMs);
    const prepared = await evaluateFrame(
      session,
      frame.frame,
      `(${CJ_LOIS_PREPARE_INVOICE_SOURCE})(${JSON.stringify(outboundInvoiceNo)})`,
      timeoutMs,
    );
    if (prepared?.error || !prepared?.prepared) {
      fail(prepared?.error || "CJ_ORIGINAL_INVOICE_FOCUS_FAILED", "CJ original-invoice input could not be prepared.", prepared || {});
    }
    if (prepared.focused !== true) {
      await (dependencies.sleep || sleep)(options.pollMs || 300);
      const refocused = await evaluateFrame(
        session,
        frame.frame,
        CJ_LOIS_FOCUS_INVOICE_EXPRESSION,
        timeoutMs,
      );
      if (refocused?.error || !refocused?.focused) {
        fail(refocused?.error || "CJ_ORIGINAL_INVOICE_FOCUS_FAILED", "CJ original-invoice input could not be focused after selecting return.", refocused || {});
      }
    }
    const originalInfo = await waitForOriginalInfoState(session, frame, dependencies, {
      ...options,
      timeoutMs,
    });
    if (!originalInfo.lookupReady) {
      const senderApplied = await evaluateFrame(
        session,
        frame.frame,
        CJ_LOIS_APPLY_SENDER_EXPRESSION,
        timeoutMs,
      );
      if (senderApplied?.error || !senderApplied?.applied) {
        fail(senderApplied?.error || "CJ_SENDER_APPLY_FAILED", "CJ return sender could not be applied.", senderApplied || {});
      }
    }
    await waitForPreparedState(session, frame, outboundInvoiceNo, dependencies, {
      ...options,
      timeoutMs,
    });
    const formPrepared = await evaluateFrame(
      session,
      frame.frame,
      `(${CJ_LOIS_PREPARE_FORM_SOURCE})(${JSON.stringify(productName)})`,
      timeoutMs,
    );
    if (formPrepared?.error || !formPrepared?.prepared) {
      fail(formPrepared?.error || "CJ_RETURN_FORM_PREPARATION_FAILED", "CJ return fields could not be prepared.", formPrepared || {});
    }
    const fareLookup = await waitForFareLookupState(session, frame, dependencies, {
      ...options,
      timeoutMs,
    });
    if (!fareLookup.formReady) {
      const fareApplied = await evaluateFrame(
        session,
        frame.frame,
        CJ_LOIS_APPLY_FARE_EXPRESSION,
        timeoutMs,
      );
      if (fareApplied?.error || !fareApplied?.applied) {
        fail(fareApplied?.error || "CJ_FARE_APPLY_FAILED", "CJ return fare could not be applied.", fareApplied || {});
      }
    }
    const snapshot = await waitForReturnFormState(session, frame, dependencies, {
      ...options,
      timeoutMs,
    });
    return {
      frame,
      initial,
      snapshot,
      outboundInvoiceNo,
    };
  };
  return {
    async inspect() {
      const frame = await findReservationFrame(session, dependencies, timeoutMs);
      const snapshot = await readSnapshot(session, frame, dependencies, timeoutMs);
      return {
        ready: snapshot.readyState === "complete",
        reservationTypeReturn: snapshot.reservationTypeReturn,
        lookupReady: snapshot.lookupReady,
        productReady: snapshot.productReady,
        completedReservationRowCount: snapshot.completedReservationRowCount,
      };
    },

    async prepareReturnPickup(step = {}) {
      const prepared = await prepareReturnPickup(step);
      return {
        outboundInvoiceNo: prepared.outboundInvoiceNo,
        reservationTypeReturn: prepared.snapshot.reservationTypeReturn,
        lookupReady: prepared.snapshot.lookupReady,
        productReady: prepared.snapshot.productReady,
        formReady: prepared.snapshot.formReady,
        saveButtonCount: prepared.snapshot.saveButtonCount,
        completedReservationRowCount: prepared.snapshot.completedReservationRowCount,
        externalWritesPerformed: false,
      };
    },

    async reserveReturnPickup(step = {}) {
      const prepared = await prepareReturnPickup(step);
      const {
        frame,
        initial,
        outboundInvoiceNo,
        snapshot: beforeSave,
      } = prepared;
      const dialog = await handleSaveDialog(session, async () => {
        const clicked = await evaluateFrame(session, frame.frame, CJ_LOIS_CLICK_SAVE_EXPRESSION, timeoutMs);
        if (clicked?.error || !clicked?.clicked) {
          fail(clicked?.error || "CJ_SAVE_CLICK_FAILED", "CJ save button could not be clicked.", clicked || {});
        }
      }, { timeoutMs: options.dialogTimeoutMs || 8_000 });
      if (dialog?.alreadyRegistered === true) {
        return {
          outboundInvoiceNo,
          evidence: [...EXISTING_RESERVATION_EVIDENCE],
          returnInvoiceTiming: "NEXT_BUSINESS_DAY",
          dialogVerified: dialog.messageVerified === true,
          alreadyRegistered: true,
          previousCompletedReservationRowCount: initial.completedReservationRowCount,
          completedReservationRowCount: beforeSave.completedReservationRowCount,
        };
      }
      const saved = await waitForSavedState(session, frame, beforeSave, dependencies, {
        ...options,
        timeoutMs,
      });
      return {
        outboundInvoiceNo,
        evidence: [...SUCCESS_EVIDENCE],
        returnInvoiceTiming: "NEXT_BUSINESS_DAY",
        dialogVerified: dialog?.messageVerified === true,
        previousCompletedReservationRowCount: initial.completedReservationRowCount,
        completedReservationRowCount: saved.completedReservationRowCount,
      };
    },
  };
}

export function isCjLoisTarget(target, origins = [CJ_LOIS_ORIGIN]) {
  return target?.type === "page"
    && origins.some((origin) => String(target.url || "").startsWith(origin));
}

export async function selectLiveCjLoisTarget(config, dependencies = {}) {
  const listing = await (dependencies.listChromeTargets || listChromeTargets)(config);
  if (!listing.available) fail("CHROME_CDP_UNAVAILABLE", "Dedicated Chrome DevTools is unavailable.");
  const origins = config.cjLoisOrigins || [CJ_LOIS_ORIGIN];
  const matches = (listing.targets || []).filter((target) => isCjLoisTarget(target, origins));
  if (matches.length !== 1) {
    fail("CJ_LOIS_TARGET_COUNT_INVALID", "Exactly one logged-in CJ LOIS tab is required.", {
      matchCount: matches.length,
    });
  }
  return matches[0];
}

export async function withCjLoisReturnPickupBrowserAdapter(config, handler, dependencies = {}) {
  const target = await selectLiveCjLoisTarget(config, dependencies);
  const connect = dependencies.withCdpTarget
    || ((selected, callback, options) => withBrowserCdpTarget(
      config,
      selected,
      callback,
      options,
    ));
  return connect(target, async (session) => {
    await ensureCjLoisReservationPage(session, dependencies.options, dependencies);
    const adapter = createCjLoisReturnPickupBrowserAdapter(session, dependencies.options, dependencies);
    const inspection = await adapter.inspect();
    if (!inspection.ready) fail("CJ_RESERVATION_PAGE_NOT_READY", "CJ reservation page is not ready.");
    return handler(adapter);
  }, { timeoutMs: dependencies.options?.timeoutMs || DEFAULT_TIMEOUT_MS });
}

export const CJ_LOIS_RETURN_PICKUP_RULES = Object.freeze({
  origin: CJ_LOIS_ORIGIN,
  pageId: "DCRVAP1003M",
  navigation: ["예약", "기업고객건별접수"],
  reservationType: "반품",
  saveConfirmation: CJ_SAVE_CONFIRMATION,
  successEvidence: SUCCESS_EVIDENCE,
  existingReservationEvidence: EXISTING_RESERVATION_EVIDENCE,
  returnInvoiceReadbackTiming: "NEXT_BUSINESS_DAY",
});
