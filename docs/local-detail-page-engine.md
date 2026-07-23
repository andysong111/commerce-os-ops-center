# 승준컴 로컬 전용 상세페이지 엔진

OPS CENTER의 기본 상세페이지 엔진은 GitHub Actions가 아니라 승준컴 PC에서 실행되는 로컬 브릿지(`http://127.0.0.1:8765`)를 호출합니다.

## 1. 로컬 브릿지 시작

승준컴 PC에서 다음 명령을 실행합니다.

```bash
python tools/run_local_ops_bridge.py --host 127.0.0.1 --port 8765
```

브릿지는 `product-detail-page-auto`를 로컬에서 실행하며 로컬 Playwright 프로필, 로컬 1688 로그인 세션, 로컬 캐시와 `generated_source`를 사용합니다. 최종 상세페이지 JPG는 1000px 기준으로 생성됩니다.

## 2. OPS CENTER 열기

OPS CENTER 대시보드 또는 사이드바에서 **상세페이지 엔진**을 엽니다. 화면에 **승준컴 로컬 전용** 배지가 표시되며, 로컬 브릿지가 꺼져 있으면 `승준컴 로컬 브릿지 실행 필요` 안내와 실행 명령이 표시됩니다.

## 3. 1688 상품 링크 모드

`/detail-page-local-runner`에서 1688 상품 링크, 상품코드, 보조 링크, 옵션/색상 메모, 기획 메모를 입력한 뒤 실행합니다. OPS CENTER 서버는 1688을 직접 호출하지 않고, 브라우저에서 localhost 브릿지의 `/runs/source-link`만 호출합니다.

## 4. 이미지 업로드 모드

1688 페이지 접근이 막히거나 수집 품질이 낮은 경우 `/detail-page-image-upload-runner`를 사용합니다. 상품명, 상품코드, 카테고리 힌트, 옵션/색상 정보, 기획 메모와 상세페이지 이미지를 다중 업로드하면 브릿지의 `/runs/upload-images`로 multipart 요청을 보냅니다.

## 5. 결과 확인과 안전장치

결과 패널은 `production_ready`, `full_image_ready`, 최종 이미지 폭/형식, 카피 품질 점수, 수집 이미지 수, blocker/warning을 보여줍니다. 최종 JPG가 준비된 경우 미리보기, JPG 열기/다운로드, 이미지 주소 복사를 사용할 수 있습니다.

자동 샵플링 API 호출이나 자동 게시 기능은 없습니다. OPS CENTER는 OpenAI를 직접 호출하지 않으며, 1688 수집도 로컬 Playwright 프로필을 가진 브릿지 프로세스가 수행합니다.
