import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { compactKeywordElonKey, normalizeKeywordElonText, uniqueKeywordElonCanonical } from '../src/lib/keywordEngineElonLabV2.ts';

const sourceCode = await readFile(new URL('../src/lib/keywordEngineElonLabV2Discovery.ts', import.meta.url), 'utf8');
const code = stripTypeScriptTypes(sourceCode.replace(/^import[\s\S]*?;\n/gm, '').replace(/\bexport /g, ''), { mode: 'strip' });
const identity = {
  coreProduct: '자석 선반', identityAnchor: '냉장고 자석 선반',
  primarySeeds: ['자석선반', '냉장고자석선반', '자석트레이', '무타공자석선반', '냉장고수납선반'],
  conditionalSeeds: [], koreanProductIdentity: '냉장고 외측 부착 수납선반',
};
const source = { chineseTitle: '', optionText: '', supportingText: '' };
const defaultMarket = {
  bridgeSeeds: ['자석선반'], marketTerms: Array.from({ length: 80 }, (_, i) => `일반시장어${i}`),
  searchSeeds: ['일반검색어'], evidenceTerms: [], apiHubQueries: [], apiHubDocumentCount: 1,
  apiHubActiveSources: ['test'], apiHubConfigured: true, warnings: [], model: 'fixture',
};
function harness(market, searchAd) {
  return new Function('compactKeywordElonKey', 'normalizeKeywordElonText', 'uniqueKeywordElonCanonical',
    'buildKeywordElonMarketRecall', 'discoverKeywordElonSearchAd', 'process', 'fetch',
    `${code}\nreturn discoverKeywordElonCandidatesResilient;`)(
    compactKeywordElonKey, normalizeKeywordElonText, uniqueKeywordElonCanonical,
    market, searchAd, { env: {} }, () => { throw new Error('External network is forbidden in this test'); });
}

test('actual discovery reserves core seeds within SearchAd first ten and the 500-candidate cap', async () => {
  const rows = Array.from({ length: 600 }, (_, i) => ({ keyword: `무관한인기검색${i}`, totalSearch: 1000000 - i, sourceSeeds: ['일반검색어'] }));
  let calledSeeds;
  const discover = harness(async () => defaultMarket, async seeds => {
    calledSeeds = seeds;
    return { configured: true, rows, warnings: [], expansionSeeds: ['일반검색어'], explorationDepth: 2 };
  });
  const result = await discover(source, identity);
  for (const seed of identity.primarySeeds) {
    const key = compactKeywordElonKey(seed);
    assert.ok(calledSeeds.slice(0, 10).includes(key), `${key} must not be displaced before the API call`);
    assert.ok(result.candidates.includes(key), `${key} must survive the candidate cap`);
  }
  assert.equal(result.candidates[0], '자석선반');
  assert.equal(result.candidates.length, 500);
  assert.equal(new Set(result.candidates).size, 500);
  assert.deepEqual(result.searchAdStats, rows, 'Recall must not fabricate demand statistics');
  assert.ok(result.sourceTagsByKeyword['자석트레이'].includes('primary_seed'));
  assert.ok(!Object.hasOwn(result, 'allowedKeys'), 'Recall must not approve keywords');
});

test('market and demand lookup failures preserve seeds but remain explicit missing evidence', async () => {
  const discover = harness(async () => { throw new Error('fixture market timeout'); }, async () => { throw new Error('fixture demand timeout'); });
  const result = await discover(source, identity);
  assert.ok(result.candidates.includes('자석선반'));
  assert.deepEqual(result.searchAdStats, []);
  assert.equal(result.searchAdConfigured, false);
  assert.ok(result.searchAdWarnings.some(value => value.includes('MARKET_RECALL_FAILED')));
  assert.ok(result.searchAdWarnings.some(value => value.includes('SEARCHAD_DISCOVERY_FAILED')));
  assert.ok(result.searchAdWarnings.some(value => value.includes('AI_DISCOVERY_NOT_CONFIGURED')));
});

test('missing product identity fails before any recall or external request', async () => {
  let calls = 0;
  const discover = harness(async () => { calls += 1; return defaultMarket; }, async () => { calls += 1; throw new Error('unexpected'); });
  await assert.rejects(discover(source, { ...identity, coreProduct: '', identityAnchor: '', primarySeeds: [], conditionalSeeds: [] }), /DISCOVERY_NO_SEED/);
  assert.equal(calls, 0);
});
