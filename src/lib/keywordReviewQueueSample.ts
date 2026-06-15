export const KEYWORD_REVIEW_QUEUE_SAMPLE_CSV = `goods_key,mall_key,current_title,recommended_title,site_srch,new_site_srch,site_srch_keyword_count,verified_keyword_count,site_srch_quality_status,final_site_srch_confidence_status,block_reason,warning_flags
121001,shop-a,Sample feeder,Improved sample feeder,feeder,"feeder, poultry, waterer, farm, tray, bird, chicken, supply, automatic, durable",10,10,PASS,PASS,,
121049,shop-a,Very long sample title,Reviewed sample title,old keyword,"candidate one, candidate two",2,2,REVIEW,REVIEW,BLOCKED_TITLE_LENGTH,
121050,shop-a,Underfilled product,Underfilled product,old keyword,"one, two, three",3,3,REVIEW,REVIEW,UNDERFILLED_SITE_SRCH,
121051,shop-a,Broad item,Broad item,old keyword,broad keyword,1,0,FAIL,FAIL,HIGH_DEMAND_BROAD_RISK,unsafe broad keyword risk
121052,shop-b,Missing optional fields,Possible title,,,,,,,,
121053,shop-b,Quoted keywords,Quoted keywords,old,"alpha, beta, ""quoted phrase"", delta",10,10,PASS,PASS,,`;
