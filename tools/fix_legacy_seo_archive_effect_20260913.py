from pathlib import Path

path = Path("src/app/legacy-seo-bulk-cloud/LegacySeoBulkCloudClient.tsx")
source = path.read_text(encoding="utf-8")
old = '''  useEffect(() => {
    void load();
    void loadItems();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load, loadItems]);'''
new = '''  useEffect(() => {
    const initialLoadTimer = window.setTimeout(() => {
      void load();
      void loadItems();
    }, 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      window.clearTimeout(initialLoadTimer);
      window.clearInterval(timer);
    };
  }, [load, loadItems]);'''
if source.count(old) != 1:
    raise RuntimeError(f"mount effect guard failed: {source.count(old)}")
path.write_text(source.replace(old, new), encoding="utf-8")
print("legacy SEO client mount scheduling fixed")
