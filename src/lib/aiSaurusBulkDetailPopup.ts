export function showSaurusPopupMessage(popup: Window | null, title: string, message: string) {
  if (!popup || popup.closed) return;
  try {
    if (popup.location.href !== "about:blank") return;
    popup.document.title = title;
    popup.document.body.textContent = message;
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== "SecurityError") throw error;
    // An existing window may already be displaying the AI Saurus Studio.
  }
}
