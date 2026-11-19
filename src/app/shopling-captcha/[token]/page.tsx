import ShoplingCaptchaClient from "./ShoplingCaptchaClient";

export const dynamic = "force-dynamic";

export default async function ShoplingCaptchaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ShoplingCaptchaClient token={token} />;
}
