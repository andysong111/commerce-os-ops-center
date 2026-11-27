import type { MetadataRoute } from "next";

export function GET() {
  const manifest: MetadataRoute.Manifest = {
    id: "/mobile-work-center",
    start_url: "/mobile-work-center",
    scope: "/",
    name: "Commerce OS 모바일 업무센터",
    short_name: "업무센터",
    lang: "ko",
    display: "standalone",
    background_color: "#f1f5f3",
    theme_color: "#132a20",
    icons: [
      { src: "/mobile-work-center/home-icon?size=192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/mobile-work-center/home-icon?size=512", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
