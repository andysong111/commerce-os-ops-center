import { PageHeader } from "@/components/PageHeader";
import { ShoplingPriceModifyRunner } from "@/components/shopling-price-modify-runner/ShoplingPriceModifyRunner";

export default function ShoplingPriceModifyRunnerPage() {
  return <><PageHeader title="샵플링 쇼핑몰별 가격설정 실행기" description="goods_key 기준으로 쇼핑몰별 가격설정을 실행합니다." /><ShoplingPriceModifyRunner /></>;
}
