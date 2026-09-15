import test from 'node:test';
import assert from 'node:assert/strict';
import { composeKeywordElonSafeMallTitles } from '../src/lib/keywordEngineElonMallTitleSafeComposer.ts';
import { composeFreshKeywordElonMallTitles } from '../src/lib/keywordEngineElonFreshMallTitleComposer.ts';
import { PRODUCT_GROUP_MARKET_REGISTRY } from '../src/lib/productGroupMarketRegistry.ts';

const words = ['허리조절핀', '바지허리조절핀'];
function fixture(extra = {}) {
  return { markets: PRODUCT_GROUP_MARKET_REGISTRY, finalKeywords: [...words], titleExpansionPool: [],
    modelName: '허리조절핀', context: { productName: '바지 허리조절핀', category: '수예용품' }, ...extra };
}
function assertValid(result, expectedWords = words) {
  assert.equal(result.rows.length, 29);
  const allowed = new Set(expectedWords);
  const covered = new Set();
  for (const row of result.rows) {
    assert.ok(Buffer.byteLength(row.title) >= 30 && Buffer.byteLength(row.title) <= 50);
    assert.equal(Buffer.byteLength(row.title), row.byteLength);
    for (const word of row.keywordMaterials) {
      assert.ok(allowed.has(word), `Unsupported material: ${word}`);
      covered.add(word);
    }
    assert.equal(row.keywordMaterials.join(' '), row.title);
  }
  assert.deepEqual(covered, allowed);
}

test('legacy direct callers remain strict unless validated reuse is explicitly enabled', () => {
  assert.throws(() => composeKeywordElonSafeMallTitles(fixture()), /고유 쇼핑몰별 상품명 29개/);
});

test('two approved materials use both valid orders before any unavoidable full-title reuse', () => {
  const input = fixture({ allowValidatedTitleReuse: true });
  const before = JSON.stringify(input);
  const result = composeKeywordElonSafeMallTitles(input);
  assertValid(result);
  assert.equal(result.uniqueTitleCount, 2);
  assert.notEqual(result.rows[0].title, result.rows[1].title);
  assert.ok(result.warnings.includes('SEO_MALL_TITLE_VALIDATED_REUSE:27'));
  assert.equal(JSON.stringify(input), before);
});

test('existing distinct-title behavior is unchanged when valid material is sufficient', () => {
  const input = fixture({ markets: PRODUCT_GROUP_MARKET_REGISTRY.slice(0, 2) });
  const strict = composeKeywordElonSafeMallTitles(input);
  const permitted = composeKeywordElonSafeMallTitles({ ...input, allowValidatedTitleReuse: true });
  assert.deepEqual(permitted.rows, strict.rows);
  assert.equal(permitted.uniqueTitleCount, 2);
});

test('zero valid 30-50 byte combinations remain blocked, even in reuse mode', () => {
  assert.throws(() => composeKeywordElonSafeMallTitles(fixture({
    finalKeywords: ['옷핀', '바지핀'], allowValidatedTitleReuse: true,
  })), /현재 0개/);
});

test('blocked materials are never restored to make more titles', () => {
  assert.throws(() => composeKeywordElonSafeMallTitles(fixture({
    blockedTerms: ['허리조절핀'], allowValidatedTitleReuse: true,
  })));
});

test('fresh bulk generation preserves scarce valid words instead of forcing unrelated additions', () => {
  const first = composeFreshKeywordElonMallTitles(fixture({ variationSeed: 'scarce-first' }));
  const second = composeFreshKeywordElonMallTitles(fixture({
    variationSeed: 'scarce-second', excludedTitles: first.rows.map(row => row.title),
  }));
  assertValid(first);
  assertValid(second);
  assert.equal(second.uniqueTitleCount, 2);
  assert.ok(second.warnings.some(value => value.startsWith('SEO_RUN_EXACT_TITLE_REUSE:')));
});

test('two incident-shaped keyword pools keep complete, valid 29-market output without invented terms', () => {
  const pools = [
    ['버드스파이크', '새퇴치스파이크', '비둘기퇴치핀', '실외기용새퇴치'],
    ['허리조절핀', '바지허리조절핀', '바지치마용허리조절핀', '바지핀', '치마허리조절핀'],
  ];
  for (const pool of pools) {
    const result = composeFreshKeywordElonMallTitles(fixture({
      finalKeywords: pool, modelName: pool[0], context: { productName: pool[0], category: '' },
      variationSeed: 'incident-shaped-replay',
    }));
    assertValid(result, pool);
    assert.ok(result.uniqueTitleCount >= 2);
  }
});
