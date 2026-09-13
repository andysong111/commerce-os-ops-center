import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { inferProductLaunchOptionName as infer, normalizeProductLaunchOptionNames as normalize, normalizeNewProductLaunchState as normalizeState } from '../src/lib/productLaunchOptionNames.ts';

const cases = [
  ['AAA482', ['라임','블랙','퍼플','블루','카키'], '색상'],
  ['AAA369', ['진핑크 6핀','진핑크 3핀','연핑크 6핀','연핑크 3핀','스카이 6핀','스카이 3핀'], '색상'],
  ['AAA419', ['액자형1p','볼트형1p'], '형태'],
];
function item(values) {
  return { id:'test', orderOptions:values.map((saleOption,i)=>({id:`test-${i}`,optionName:'옵션',saleOption,barcode:`TEST-${i}`,optionBarcodeNo:String(i+100).padStart(12,'0'),baseSalePriceKrw:1000+i,stock:10+i})) };
}
for(const [model,values,title] of cases) {
  test(`${model}: all actual values normalize and all other fields stay unchanged`,()=>{
    const original=item(values), before=structuredClone(original), next=normalize(original);
    assert.equal(infer(values),title);
    assert.deepEqual(original,before);
    for(let i=0;i<values.length;i++) {
      const {optionName,optionNameNormalization,...rest}=next.orderOptions[i];
      const {optionName:previous,...expected}=before.orderOptions[i];
      assert.equal(optionName,title);
      assert.equal(optionNameNormalization.originalTitle,previous);
      assert.deepEqual(rest,expected);
    }
    assert.equal(normalize(next),next);
  });
}
test('unknown, mixed and malformed values retain the existing upload rejection path',()=>{
  for(const values of [[],['A','B'],['30cm','40cm'],['액자형1p','미분류'],['라임향','블랙'],['스카이라인','블랙'],['라임','블랙',null]]) {
    assert.equal(infer(values),null);
    const original=item(values); assert.equal(normalize(original),original);
  }
  const malformed={orderOptions:[null]}; assert.equal(normalize(malformed),malformed);
});
test('manual semantic names and different axes are preserved',()=>{
  const original=item(['A','B']); original.orderOptions.forEach(o=>o.optionName='호환모델');
  assert.equal(normalize(original),original);
  const mixed=item(['라임','블랙']); mixed.orderOptions[1].optionName='사이즈';
  assert.equal(normalize(mixed),mixed);
});
test('a partial assortment never gains invented combinations',()=>{
  const next=normalize(item(['진핑크 6핀','스카이 3핀']));
  assert.deepEqual(next.orderOptions.map(o=>o.saleOption),['진핑크 6핀','스카이 3핀']);
});
test('ordinary saves leave existing successful listings untouched',()=>{
  const live={...item(['라임','블랙']),shoplingProducts:{wholesale1:{status:'success',goodsKey:'test-existing'}}};
  const draft=item(['라임','블랙']); const next=normalizeState({items:[live,draft]});
  assert.equal(next.items[0],live);
  assert.equal(next.items[1].orderOptions[0].optionName,'색상');
  assert.equal(draft.orderOptions[0].optionName,'옵션');
});
test('changed automatic values are re-evaluated rather than mislabeled',()=>{
  const next=normalize(item(['라임','블랙']));
  next.orderOptions[0].saleOption='미분류';
  assert.deepEqual(normalize(next).orderOptions.map(o=>o.optionName),['옵션','옵션']);
});
test('single-item and established semantic families remain supported',()=>{
  for(const [values,title] of [[['단품'],'단품'],[['블랙','화이트'],'색상'],[['1개','2개입','1+1'],'수량'],[['소형','대형'],'사이즈'],[['실리콘','스테인리스'],'재질'],[['100ml','200ml'],'용량'],[['1kg','2kg'],'무게']]) assert.equal(infer(values),title);
});
test('both persistence formats and both upload builders apply the shared naming function',async()=>{
  const source=path=>readFile(new URL('../src/lib/'+path,import.meta.url),'utf8');
  assert.match(await source('productLaunchTrackerServer.ts'),/normalizeNewProductLaunchState\(state\)/);
  assert.match(await source('productLaunchTrackerNormalizedStore.ts'),/normalizeProductLaunchOptionNames\(itemsById.get\(summary.id\)/);
  assert.match(await source('productLaunchTrackerShopling.ts'),/normalizeProductLaunchOptionNames\(asRecord\(itemInput\)\)/);
  assert.match(await source('legacySeoShoplingPayload.ts'),/normalizeProductLaunchOptionNames\(record\(itemInput\)\)/);
  assert.match(await source('legacySeoShoplingRegistration.ts'),/item = normalizeProductLaunchOptionNames\(item\)/);
});
