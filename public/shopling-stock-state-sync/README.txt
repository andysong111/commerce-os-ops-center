Commerce OS · Shopling Stock State Sync v0.4.4

사용자 준비
- Stock State Sync 구버전은 모두 제거/비활성화하고 v0.4.4 하나만 사용합니다.
- Shopling에 로그인 완료한 관리자 메인 탭 하나와 Commerce OS 재고·품절·재입고 탭만 열어둡니다.
- A4/A21은 미리 열 필요가 없습니다. 실행 시 필요한 전용 작업창만 자동 생성합니다.
- 옵션상품은 A6 작업창을 생성하지 않습니다.
- 재고 0 기준점은 다시 만들지 않고 1건 안전 실행만 합니다.

실행
- 옵션: Commerce OS 서버 → Shopling API에서 B코드 옵션 정확 1건 검증 → 현재 optQty 보존 → optStatus만 판매중(B)/품절(C) 변경·재검증 → A21 goods key 정확검색 → 같은 goods key 쇼핑몰 행 전체 선택(최대 200건) → 수정전송 팝업 → 옵션송신.
- 단품: 자동 생성 A4 → goods key 정확검색 → 상품상태 품절/판매중 → A21 → 상품판매상태송신.
- A22 및 마켓 재고수량 동기화는 사용하지 않습니다.

v0.4.4 A21 수정전송 팝업
- 현재 운영 중인 Shopling A21 가격·옵션 수정전송 v0.4.4의 실제 구조를 기준으로 재작성했습니다.
- 팝업은 background가 한 번의 타이밍으로 찾아주기를 기다리지 않고 STOCK_SYNC_A21_POPUP_CLAIM_V044로 현재 재고동기화 RUNNING 작업을 스스로 claim합니다.
- 옵션송신은 화면 글자나 위치를 추측하지 않습니다. Shopling 실제 form 계약인 modify_tp=goods_stock과 trsmt_env_mody_opt=1을 직접 선택하고 라디오 그룹의 단독선택 상태를 재검증합니다.
- prod_join_chk[] 전송대상이 1건 이상이며 모두 숫자인지 검증합니다.
- 옵션 설정 후 MAIN world 전용 main-a21-stock-v044.js가 window.goods_mallMdfy_submit_sp() 원본 함수를 호출합니다.
- 원본 confirm 문구 '수정전송 할 상품을 선택하셨습니까'만 자동 승인하며 예상 밖 confirm/alert는 실패로 처리합니다.
- 팝업 content worker와 MAIN-world bridge는 재고동기화 전용 event namespace를 사용해 가격조정 확장과 충돌하지 않도록 분리합니다.
- 단품 상품판매상태송신은 기존 팝업 경로를 유지합니다.

v0.4.2 A21 다건 선택
- goods key 1개 검색 시 여러 쇼핑몰 상품행이 나오는 것이 정상입니다.
- 화면출력을 200개로 맞추고 조회결과 1~200건이면 모든 행이 정확 goods key인지 검증한 뒤 전체 선택합니다.
- 조회건수와 정확 goods key 행 수가 다르면 전송하지 않습니다.
- 200건 초과 시 부분 전송하지 않고 안전 중단합니다.

v0.4.1 검색 안전장치
- 실제 A21 '검색항목' 행의 드롭다운과 같은 행의 입력칸만 사용합니다.
- 상단 전역 검색창은 사용하지 않습니다.
- 동일 실행에서 검색 버튼을 중복 클릭하지 않습니다.

v0.4.0 옵션상태 API 전환
- A6 레거시 웹조작은 옵션상품 경로에서 제거했습니다.
- Shopling API에서 optPtnOptCd가 B코드와 정확히 일치하는 옵션 1건만 변경합니다.
- optQty는 Shopling 현재값을 그대로 보존하고 optStatus만 B↔C로 변경합니다.
- API 성공 및 readback 검증 후에만 A21을 실행합니다.

구현/배포
- Shopling API 인증정보는 Commerce OS 서버 환경변수에서만 사용합니다.
- 가격조정 확장 자체는 수정하지 않습니다.
- 재고·발주·취소·반품 데이터와 계산 로직은 수정하지 않습니다.
