import { ImageResponse } from "next/og";

export function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("size");
  const size = requested === "512" ? 512 : requested === "192" ? 192 : 180;
  return new ImageResponse(
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", background: "#132a20", color: "#ffffff", fontWeight: 800, fontSize: size / 2 }}>
      C
    </div>,
    { width: size, height: size },
  );
}
