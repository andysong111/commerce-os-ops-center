export function formatBrowserLocalDateTime(isoString: string, locale?: string) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  const resolvedLocale = locale ?? (typeof navigator !== "undefined" ? navigator.language : "ko-KR");
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return new Intl.DateTimeFormat(resolvedLocale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(date);
}
