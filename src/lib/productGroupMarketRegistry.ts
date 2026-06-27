export type ProductGroupMarketAccount = {
  productGroup: string;
  groupSuffix: string;
  productGroupType: "도매" | "소매" | "기타" | "확인 필요";
  marketName: string;
  mallType: string;
  mallKey: string;
  accountIdLabel: string;
};

const wholesale = "도매" as const;
const retail = "소매" as const;

export const PRODUCT_GROUP_MARKET_REGISTRY: ProductGroupMarketAccount[] = [
  ["도매1","a",wholesale,"카페24(1.9)","종합몰","SMALL_00014","andy801"],
  ["도매1","a",wholesale,"도매꾹","B2B쇼핑몰","SMALL_00069","andy8010"],
  ["도매1","a",wholesale,"도매창고","B2B쇼핑몰","SMALL_00071","andy801"],
  ["도매1","a",wholesale,"오너클랜","B2B쇼핑몰","SMALL_00107","2010022841"],
  ["도매1","a",wholesale,"셀파","B2B쇼핑몰","SMALL_00116","andy8010"],
  ["도매1","a",wholesale,"셀링콕","B2B쇼핑몰","SMALL_00165","andy801"],
  ["도매1","a",wholesale,"투비즈온","B2B쇼핑몰","SMALL_00179","andy801"],
  ["도매1","a",wholesale,"도매아토즈","B2B쇼핑몰","SMALL_00180","andy801"],
  ["도매1","a",wholesale,"셀리어스","B2B쇼핑몰","SMALL_00188","andy801"],
  ["도매1","a",wholesale,"도매의신","B2B쇼핑몰","SMALL_00190","andy801"],
  ["도매2","b",wholesale,"도매꾹","B2B쇼핑몰","SMALL_00069","buzz1237"],
  ["도매2","b",wholesale,"오너클랜","B2B쇼핑몰","SMALL_00107","2010024263"],
  ["도매2","b",wholesale,"셀파","B2B쇼핑몰","SMALL_00116","andy80101"],
  ["도매2","b",wholesale,"셀링콕","B2B쇼핑몰","SMALL_00165","andy8010"],
  ["도매3","c",wholesale,"도매꾹","B2B쇼핑몰","SMALL_00069","everysale999"],
  ["도매3","c",wholesale,"오너클랜","B2B쇼핑몰","SMALL_00107","2010026398"],
  ["도매3","c",wholesale,"셀파","B2B쇼핑몰","SMALL_00116","andydome103"],
  ["도매3","c",wholesale,"셀링콕","B2B쇼핑몰","SMALL_00165","andydome103"],
  ["도매4","d",wholesale,"도매꾹","B2B쇼핑몰","SMALL_00069","andy80101"],
  ["소매1","e",retail,"옥션","오픈마켓","SMALL_00001","andy801"],
  ["소매1","e",retail,"지마켓","오픈마켓","SMALL_00002","andy80101"],
  ["소매1","e",retail,"11번가","오픈마켓","SMALL_00003","andy80101"],
  ["소매1","e",retail,"스마트스토어","오픈마켓","SMALL_00004","andy8010@naver.com"],
  ["소매1","e",retail,"GS SHOP","홈쇼핑","SMALL_00005","1053784"],
  ["소매1","e",retail,"쿠팡","오픈마켓","SMALL_00012","andy801"],
  ["소매1","e",retail,"신세계몰","종합몰","SMALL_00019","andy8010@naver.com"],
  ["소매1","e",retail,"카카오톡 스토어","오픈마켓","SMALL_00101","andy8010@navercom 동네일등"],
  ["소매1","e",retail,"에이블리","전문몰","SMALL_00112","andy8010@naver.com"],
  ["소매1","e",retail,"롯데ON","오픈마켓","SMALL_00130","andy801"],
  ["소매1","e",retail,"인큐텐","종합몰","SMALL_00168","andy801"],
  ["소매1","e",retail,"토스쇼핑","종합몰","SMALL_00194","andy8010@naver.com"],
  ["소매2","f",retail,"옥션","오픈마켓","SMALL_00001","andy80101"],
  ["소매2","f",retail,"지마켓","오픈마켓","SMALL_00002","andy80102"],
  ["소매2","f",retail,"11번가","오픈마켓","SMALL_00003","andy80102"],
  ["소매2","f",retail,"쿠팡","오픈마켓","SMALL_00012","andy80101"],
  ["소매2","f",retail,"토스쇼핑","종합몰","SMALL_00194","andy80101@naver.com"],
].map(([productGroup, groupSuffix, productGroupType, marketName, mallType, mallKey, accountIdLabel]) => ({ productGroup, groupSuffix, productGroupType, marketName, mallType, mallKey, accountIdLabel } as ProductGroupMarketAccount));

export function getMarketsForProductGroup(productGroup: string): ProductGroupMarketAccount[] {
  return PRODUCT_GROUP_MARKET_REGISTRY.filter((account) => account.productGroup === productGroup.trim());
}

export function getMarketsForGroupSuffix(groupSuffix: string): ProductGroupMarketAccount[] {
  return PRODUCT_GROUP_MARKET_REGISTRY.filter((account) => account.groupSuffix === groupSuffix.trim());
}
