import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProductLaunchShoplingPayload } from '../src/lib/productLaunchTrackerShopling.ts';
import { buildLegacySeoShoplingPayload } from '../src/lib/legacySeoShoplingPayload.ts';

const cases=[
  [['라임','블랙','퍼플','블루','카키'],'색상'],
  [['진핑크 6핀','진핑크 3핀','연핑크 6핀','연핑크 3핀','스카이 6핀','스카이 3핀'],'색상'],
  [['액자형1p','볼트형1p'],'형태'],
];
function fixture(values,title) {
  return {id:'test-only',modelNumber:'AAA999',productName:'테스트 상품',selfCodeBase:'TEST',shoplingCategory:'생활/건강>수납',detailPageAsset:{html:'<p>테스트</p>',mainImageUrl:'https://example.invalid/a.jpg'},orderOptions:values.map((saleOption,i)=>({optionName:title,saleOption,barcode:`BAA1-${i+1}`,optionBarcodeNo:String(i+100).padStart(12,'0'),baseSalePriceKrw:1000+i*100,unitCostKrw:500,stock:9+i}))};
}
for(const [name,build] of [['normal',buildProductLaunchShoplingPayload],['legacy',buildLegacySeoShoplingPayload]]) {
  test(`${name}: inferred and explicit semantic titles produce identical complete payloads`,()=>{
    for(const [values,title] of cases) {
      const original=fixture(values,'옵션'),snapshot=structuredClone(original);
      const inferred=build(original,{},'test-only-request');
      const explicit=build(fixture(values,title),{},'test-only-request');
      assert.deepEqual(inferred,explicit);
      assert.deepEqual(original,snapshot);
      assert.equal(inferred.channels.length,6);
      for(const channel of inferred.channels) {
        assert.deepEqual(channel.options.map(o=>o.saleOption),values);
        assert.deepEqual(channel.options.map(o=>o.barcode),snapshot.orderOptions.map(o=>o.barcode));
        assert.deepEqual(channel.options.map(o=>o.optionBarcodeNo),snapshot.orderOptions.map(o=>o.optionBarcodeNo));
      }
    }
  });
  test(`${name}: single-item and incomplete assortments are not expanded`,()=>{
    const single=build(fixture(['단품'],'옵션'),{},'test-only-request');
    assert.equal(single.channels[0].options.length,1);
    assert.equal(single.channels[0].options[0].optionName,'단품');
    const partial=build(fixture(['진핑크 6핀','스카이 3핀'],'옵션'),{},'test-only-request');
    assert.deepEqual(partial.channels[0].options.map(o=>o.saleOption),['진핑크 6핀','스카이 3핀']);
  });
}
