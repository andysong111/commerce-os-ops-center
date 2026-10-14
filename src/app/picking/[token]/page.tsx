import PickingClient from "./PickingClient";

export const dynamic = "force-dynamic";

export default async function PickingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PickingClient token={token} />;
}
