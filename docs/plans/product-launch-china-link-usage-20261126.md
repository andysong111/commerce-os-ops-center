# 상품출시 중국 링크 이관

상품에 저장된 링크 순서를 기준으로 첫 유효 링크를 공통에 두고, 이후 링크는 기존 순서대로 발주 후보에 저장한다. 공통 모드에서는 두 작업에서 공통 링크를 읽는다. 용도별 링크가 입력된 상품은 단독 설정한 주소를 해당 작업에서 읽는다.

기존 데이터 읽기에서 상품 364건을 확인했다. 유효 링크 1개인 상품 261건, 2개 이상인 상품 99건, 유효 링크가 없는 상품 4건이다. 한 글자 표식인 `ㅁ`, `ᄆ`, `x`, `v`가 있는 6개 상품의 기존 필드는 보관한다. 표식 이외에 유효하지 않은 기존 링크가 발견되면 해당 상품을 건너뛰고 ID를 보고한다.

## 운영 작업

새 기능을 배포한 뒤 기존 상품출시 진행관리 운영 권한으로 실행한다. 로그인이나 배포 보호가 적용된 경우 해당 환경의 승인된 운영 세션 설정을 사용한다. 환경 변수 `OPS_PRODUCT_LAUNCH_SESSION_COOKIE`에는 그 원본의 로그인 세션 쿠키를 전달할 수 있다. 표준 Vercel 배포 자동화 보호 키가 설정된 경우에만 도구가 그 키를 헤더에서 사용한다. 적용 대상 원본은 기본 운영 주소이며, 검증 환경은 `OPS_PRODUCT_LAUNCH_ORIGIN`으로 지정한다.

    node scripts/migrate-product-launch-china-link-usage.mjs --dry-run
    node scripts/migrate-product-launch-china-link-usage.mjs --apply <미리보기-digest> --receipt <새-영수증-경로>
    node scripts/migrate-product-launch-china-link-usage.mjs --dry-run

미리보기에서 원본 링크와 실제 개별 상품 편집기의 정규화 데이터를 대조한다. 정규화 상품이 더 최근에 수정되었더라도 링크가 일치하면 이관하며 그 밖의 상품 필드는 그대로 검증한다. 링크가 다른 경우에는 더 최근인 원본의 과거 발주초안 역저장 기록과 링크 배열이 일치하는 경우에만 이관한다. 미리보기 결과의 `recognizedHistoricalWrites`와 `newerMatchingDetails`에 해당 건수가 표시된다.

`--apply`는 같은 미리보기 해시와 원본 저장 시각이 일치하면 최대 30개씩 수정한다. 각 상품의 정규화 저장 시각과 링크도 함께 대조하며, 원본과 정규화 조회를 다시 읽어 다른 필드가 유지되었는지 확인한다. 정규화 또는 동시 변경 오류가 발생하면 중단한다. 마지막 미리보기에서 `candidates: 0`, 예상 `alreadyMigrated` 및 `noLinks` 건수를 확인한다. 적용 전 일부 상품이 수정되었거나 적용을 중단한 경우에는 최신 미리보기로 다시 대상과 해시를 확인한다.

영수증을 보관하면 적용 후 별도 수정된 상품을 보존하면서 이미 적용된 나머지 상품을 복구할 수 있다. 영수증에는 상품 ID와 해시만 보관하며 링크 원문과 자격 증명을 포함하지 않는다.

    node scripts/migrate-product-launch-china-link-usage.mjs --rollback --receipt <기존-영수증-경로>
