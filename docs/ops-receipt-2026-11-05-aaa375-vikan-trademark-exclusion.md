# AAA375 바이칸 상표 키워드 등록 제외 기록

- 사건 ID: `AAA375_VIKAN_TRADEMARK_MARKET_DELETE_20261105`
- 대상 상품: `AAA375` / 세탁기 청소솔 / B코드 `BGC3-1`
- Commerce OS 출시 항목: `8af85b05-9341-43d0-b5bd-07bc638784ce`
- SEO 실행: `seo-run-89befd62-4af1-4f18-a678-856a58b87055`
- 샵플링 상품코드: `122866`, `122867`, `122868`, `122870`, `122873`, `122875`
- 원본 화면 증거 SHA-256: `732E0F3156E4017A30FF9BCCC401FB7B2DF78637AE9A06F7DE628DDF0F5E9375`

## 운영 판단

SEO 대량등록 결과에 상표 키워드 `바이칸`이 포함됐다. 사용자는 화면에서 확인한 마켓 연동 6건을 직접 삭제하기로 했고, Commerce OS에는 즉시 재등록 차단과 관리 제외를 요청했다.

원본 출시상품, B코드, 옵션, 재고, 과거 판매이력은 삭제하지 않는다. Commerce OS의 완료 SEO 실행은 감사 근거를 보존한 채 보관 처리하고, 상품은 `seoExclusion.excluded=true`로 전환한다. 외부 샵플링 삭제는 Commerce OS가 실행하지 않았으므로 완료로 기록하지 않으며, 삭제 후 A4 독립 재조회가 남아 있다.

## 사용자가 삭제할 마켓 연동 6건

| 연동번호 | 쇼핑몰 | 로그인 ID | 샵플링 상품코드 | 쇼핑몰 상품코드 |
|---:|---|---|---:|---|
| 3384647 | 셀파 | andy80101 | 122867 | HS03344167 |
| 3384646 | 오너클랜 | 2010024263 | 122867 | WFRYG6S |
| 3384672 | 도매꾹 | everysale999 | 122868 | 69004344 |
| 3384671 | 오너클랜 | 2010026398 | 122868 | WFRYG6N |
| 3384653 | 도매꾹 | andy80101 | 122870 | 69004326 |
| 3384645 | 도매꾹 | buzz1237 | 122867 | 69004317 |

## Commerce OS 반영

- `product_launch_items.summary_payload`와 `item_payload`에 동일 사건·대상 6건·외부 삭제 미검증 상태를 저장했다.
- `seoExclusion.excluded=true`, 사유 `TRADEMARK_TERM_VIKAN_OWNER_EXCLUSION`, 금지어 `바이칸`으로 재등록을 차단했다.
- 완료 SEO 실행 1건을 `archived_at`으로 보관해 활성 SEO 대량등록 화면에서 제거했다.
- 연결된 생명주기 원장 6개를 모두 `EXCEPTION`으로 전환하고 같은 사유를 남겼다.
- 생명주기 감사 이벤트 6개를 추가했다.
- 공통 SEO 금지어에 `바이칸`을 추가해 검색어와 쇼핑몰 상품명 생성 양쪽에서 차단한다.

## 반영 및 검증 결과

- 출시 항목 1건에서 summary/item 제외값과 사건 ID가 일치했다.
- 저장된 연동번호는 6개이며 중복 0개, 누락 0개, 예상 밖 사건 항목 0개였다.
- 생명주기 상품코드 6개가 모두 `EXCEPTION`·`TRADEMARK_TERM_VIKAN_OWNER_EXCLUSION`이며 감사 이벤트도 6개였다.
- SEO 실행은 1건만 보관됐고 기존 `registration_status=success` 감사 이력은 보존됐다.
- 원본 출시 항목은 삭제하지 않았고 옵션행 1개도 보존됐다.
- 외부 삭제는 `marketListingsDeleted=false`, `shoplingA4ReadbackVerified=false`로 기록했다.
- 회귀 테스트는 `바이칸틈새브러쉬`가 검색어·쇼핑몰 상품명에서 제거되고 FINAL 우회 입력도 차단되는지 확인한다.
