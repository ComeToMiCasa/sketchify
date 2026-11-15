# 진행 상황

마일스톤이 끝날 때마다 위에 새 항목을 추가한다.

## 현재 단계

M7 폼과 base (시작 전)

## 다음에 할 일

- M7 폼과 base. `a`의 브라우저 기본 밑줄(CSS에 안 쓴 밑줄)도 base에서 다룰 것.
- 거친 단색의 모양이 작은 요소에서 얇아짐: Rough.js가 사각형 꼭짓점을 2~3px 안쪽으로 흔들어, 높이 12px 막대가 8~9px 두께로 보인다. 필요하면 작은 요소용으로 흔들림을 줄일 것.
- 채움과 한 변 선은 함께 그리지 않음(원래대로). 필요하면 이후 과제.
- 두세 변에만 있는 테두리(위+아래, ㄱ자)는 원래 CSS로 둠. 경고는 M8, 손그림은 필요하면 이후 과제.
- 한 변 선의 길이 방향으로 32px(양 끝 16px × 2)보다 짧은 요소는 브라우저가 양 끝 조각을 줄인다(테두리의 작은 요소 문제와 같음).
- radius가 %·모서리별·타원, 32px보다 큰 값(알약·원)인 테두리: 원래 CSS 테두리로 둠. 손그림은 설계가 필요 (spec "그리는 테두리와 그대로 두는 테두리").
- M4 한계 (spec "여러 규칙에 걸친 테두리"): 문맥이 다른 구성원끼리, 다른 묶음끼리(`.btn`+`.card`)는 조합하지 않음, `@layer` 우선순위 미계산. 그릴 수 없는 조합(dashed 등)의 경고는 M8.
- 조합 용량: design-system 페이지 조합 규칙 16개, 그림 480장(40종 × 12), 원본 491KB / gzip 24.7KB / brotli 11.0KB. 원본 크기가 커서 CSS 파싱 비용이 걱정됨. M8 용량 보고·예산의 기초 자료.
- M7(폼) 참고: WebKit은 기본 모양(`appearance: auto`)의 `select`의 radius를 CSS와 상관없이 5px로 계산한다. 손그림은 CSS 값(6px)으로 그려지므로 1px 어긋남. M4 오라클 테스트에서는 `select`를 뺐다.
- 높이나 너비가 모서리 조각 2개(각진 28px, 둥근 2×(4+r))보다 작은 요소는 브라우저가 `border-image-width`를 비례 축소해 선이 가늘어지고 모서리가 작아진다(예: 13px 글자의 칩). 명세의 "작은 요소에서 모서리를 축소하지 않게"와 맞는지 확인 필요.
- px가 아닌 두께(em, rem)는 그대로 둠. 지원 여부 결정 필요.
- 이웃 변형을 한 변 선(M5), 폼·체크박스·라디오·아바타(M7)에도 적용. `src/emit/variants.ts`의 고르는 규칙과 칸 변수 방식을 그대로 쓸 수 있다.
- 가상 요소 규칙은 섞이지 않고 항상 같은 그림(seed 0)을 쓴다. 가상 요소가 많은 페이지에서 반복이 보이면 방법을 다시 찾을 것.
- 규칙마다 붙는 칸 변수 12개가 용량의 일부를 차지한다(해시 이름은 압축이 잘 안 됨). M8 용량 보고에서 줄일 방법 검토(예: 짧은 이름, 규칙 묶기).
- Firefox(지원 범위 밖): hover로 그림이 바뀔 때 테두리가 한 프레임 비어 깜빡인다(2026-11-08 확인, Chrome·Safari는 문제 없음). 원래 테두리 색이 `transparent`라 `border-image`가 비는 순간 아무것도 안 보이는 것으로 추정. Firefox 지원을 검토할 때 hover 그림을 미리 디코딩하는 방법을 찾을 것.
- 색 해석의 한계 (spec "색 해석"): 조건 두 개가 동시에 맞을 때의 겹침, `@layer` 우선순위, 다른 파일의 변수. 실제 페이지에서 문제가 되면 다시 볼 것.
- 미리보기: 지금은 scratchpad의 일회용 스크립트로 원본·변환 비교 페이지를 만든다. 필요하면 `npm run preview`로 프로젝트에 추가.
- GitHub 원격 저장소를 연결하고 `.github/workflows/ci.yml`이 실제로 도는지 확인 (M0에서는 로컬만 확인).
- CI 캐시·매트릭스는 필요해지면 그때 추가.

## M6d 밑줄 (2026-11-15)

- 한 일: `text-decoration` 밑줄을 한 변 선(M5)과 같은 손그림 선으로 바꿈(인라인 요소, solid 한 줄, 빌드 때 아는 색).
  - 실제 테두리 없이 `border-image`(px 너비·outset)로 글자 상자 바로 아래에 그림. 레이아웃 불변, 줄마다 양 끝이 있는 선.
  - 테두리 그림과 같은 요청 종류(`underline`)라 이웃 12장, hover 색, 다크 조건, M4 조합을 그대로 씀. 끄기는 `border-image: none`, 브라우저 밑줄 되살리기는 `text-decoration-line: underline`, 다른 선은 그 값을 다시 씀.
- 정한 것(사용자 결정 2026-11-15): 인라인 요소만(타입 또는 `display: inline`), 색을 모르면 원래 밑줄, 그리는 방식은 border-image(처음 계획의 배경 방식을 바꿈). spec.md "한 변 border, hr, 밑줄"에 반영.
- 배경 방식에서 바꾼 이유: 처음에는 계획대로 배경(100% × 6px)으로 구현해 모든 테스트를 통과시켰으나, 글자 상자 안이라 선이 움직일 폭이 3px 남짓이었음. 흔들림을 키우면 위 획이 글자를 가로질러 취소선처럼 보이고(첫 시도), 줄이면 거의 곧은 선이 됨. 후보 5가지(두 획/한 획, 휨, 기울기, 굵기)를 비교해도 boxes의 border-bottom만큼 손그림처럼 보이지 않았음. 테두리 없는 border-image가 두 브라우저에서 그려지는 것을 확인하고 사용자 결정으로 바꿈.
- 구현 중 고친 것:
  - 부모에서 색을 받는 링크(`.footer a { color: inherit }`)의 밑줄이 아예 사라지던 문제: 브라우저 밑줄을 되살림(`native`).
  - 되살린 밑줄이 `a:hover { text-decoration: none }`을 이기던 문제: 끄는 쪽(`off`)이 요소의 원래 선 값을 다시 씀.
  - 글자 색·장식은 밑줄을 쓰는 요소에서만 읽음(다른 테두리 묶음의 변수 읽기에 섞이지 않게).
- 테스트: 파싱·배치(단위), 출력·대상 아닌 경우 8가지·테두리와 함께·hover·다크·되살리기(플러그인), 새 페이지 `test/pages/underline`과 픽셀 테스트 `underline.spec.ts`, M4 오라클에 이 페이지와 대조 테스트 추가. 오라클은 계산된 스타일로 이유를 알 수 없는 두 요소(물려받은 색, 클래스만 있는 span)를 `data-oracle-native`로 빼고 비교.
- 남은 일:
  - `a`의 브라우저 기본 밑줄은 CSS에 없어 그리지 않음 → M7 base.
  - 테두리가 있는 요소의 밑줄은 브라우저 것 그대로(그림 자리가 하나).
  - 부모의 `overflow: hidden`이 글자 상자 아래 선을 자를 수 있음 → M8 경고.
  - `text-underline-offset` 미반영.

## M6c 채움: 정밀 빗금 (2026-11-15)

- 한 일: 크기를 아는 요소의 빗금을 선마다 계산해 테두리와 한 SVG로 그림(`border-image`, 9-slice 배치 그대로).
  - 크기: `--sketch-size`, 또는 캐스케이드로 정한 px `width`·`height`·`padding`·`box-sizing`(전체 규칙 `*` 포함). 모르면 반복 빗금(M6b).
  - 선 끝은 선마다 [바깥 `over`, 테두리 중심] 사이, 둥근 모서리 안쪽, `ends` square/taper. `ends`·`over` 옵션이 이제 쓰임.
  - 테두리는 빗금 없는 요소와 같은 정사각형 그림을 9조각으로 붙여, 이웃과 모양이 같음(픽셀 비교로 확인).
  - 이웃 12장(뒤집기는 테두리에만), hover·다크 색, 크기 수정자 조합, 조건에서 크기가 사라지면 오류.
  - 슬라이더 페이지에 크기를 아는 카드 미리보기, `over`·`ends` 조절 추가.
- 정한 것(사용자 결정 2026-11-15): 이웃 12장, box-sizing에 따라 크기 계산, 상한을 두고 넘으면 반복 빗금. 계획 승인으로 정한 것: 적용 범위, 출력 모양, 선 끝, 크기 규칙의 묶음 참여, `--sketch-size` 형식. spec.md "채움", "크기 처리"에 반영.
- 측정과 상한: 처음 그린 그림(8px마다 절대 좌표)은 220×120 normal 한 색 12장이 brotli 24KB였음. 24px마다 상대 좌표로 바꿔 6.4KB. 상한은 측정해서 480×320px²로 정함(spec "크기 처리" 표).
- 구현 중 고친 것:
  - 크기 선언만 있는 규칙(`.card.card--wide { width }`)은 선언을 넣을 자리가 없어 그림이 빠지던 문제: 크기 선언도 넣을 자리로 씀.
  - 빗금이 있으면 테두리 정사각형 그림의 여백이 달라 Rough.js 모양이 바뀌던 문제: 테두리는 빗금 없는 요소의 기하로 그림.
  - 바깥 여유가 소수(9.2px)라 테두리 안티에일리어싱이 달라지던 문제: 정수 px로 올림.
- M6b 예시 페이지(사용자 결정 2026-11-15): 카드에 px width·height가 있어 정밀 빗금이 되던 것을, `height` → `min-height`로 바꿔 크기를 모르는 요소로 되돌림(레이아웃 같음, 반복 빗금 테스트의 뜻 유지). hatch 스냅샷은 CSS 글자만 바뀌고 그림은 같음.
- 결과: lint, 단위 377, 브라우저 214(Chromium, WebKit), 빌드 통과.
- 테스트: 값 파싱·크기 계산·요청(단위), 선 끝 범위·둥근 모서리·taper·12장·뒤집기 방향·9조각 배치(그리기), 출력 형식·대체 경우·오류·조합(플러그인), 새 페이지 `test/pages/exact-hatch`와 픽셀 테스트 `exact-hatch.spec.ts`, M4 오라클에 이 페이지와 대조 테스트(틀린 힌트는 달라야 함) 추가.
- 남은 일:
  - `box-sizing: inherit`(html에서 물려받는 흔한 리셋)은 모르는 크기로 봄. 필요하면 html 규칙에서 따라가기.
  - UA 기본 padding(`button` 등)은 모름: 그 요소는 그림이 약간 늘어남. M7 폼에서 다시 볼 것.
  - 실제 크기가 계산과 다른지(flex 수축, min/max) 알 수 없음. M8 경고 후보.
  - 큰 요소 여럿이면 용량이 큼(색마다 6~17KB). M8 용량 보고에서 다시 볼 것.

## 빗금 마커 프리셋 (2026-11-15, 사용자 요청)

- 정한 것(사용자 결정): `normal`·`bold`를 두꺼운 마커펜처럼. 후보 A로 하고 굵기 흔들림을 줄임.
  - `normal`(기본) 6/16, weightJitter 0.15, pressure 0.04. `bold` 9/24, weightJitter 0.2, pressure 0.04.
  - `fine` 1.9/6은 펜 느낌 그대로(pressure 0.16을 프리셋에 직접 적음).
  - 세 프리셋 모두 타일 192px. 기본 타일이 198 → 192px로 바뀜.
- 함께 고친 버그: 마커 굵기에서 가로 이음매(타일 위·아래)가 0.5~1px 어긋남. 선 끝이 6px 간격 점에 맞춰 잘려 최대 6px 짧게 끝날 수 있었음. 점 하나만큼 더 남기도록 고침.
- 테스트:
  - 결정에서 따라 나온 수정: 기본 타일 198 → 192(draw·plugin), hatch 스냅샷 갱신.
  - 사용자 승인으로 고친 것: ① 기존 이음매 연속성 테스트는 타일 안쪽 점만 셈(선이 굵어 점이 28개로 줄고, 못 찾은 2개는 보이지 않는 타일 밖·모서리 점). ② 측정 대조 테스트는 2배 대신 1.5배 굵기, 기준 0.5 → 0.3(2배면 선이 붙어 틈이 없어 잴 수 없음).
  - 이음매 검사를 강화: 모든 프리셋과 굵기 12에서 연속으로 어긋나는 샘플이 0개.
  - 측정값: fine 1.91/6.00, normal 5.98/16.00, bold 9.02/24.00 (Chromium).
- 슬라이더 범위 확대: 굵기 16, 간격 40까지.
- 사용자가 이 값으로 확정함(2026-11-15). 빗금 프리셋 작업 끝.

## 굵은 빗금의 이음매 홈 수정 (2026-11-15, 사용자 요청)

- 발견: 마커처럼 굵은 빗금 후보(굵기 12, 간격 26)를 비교하다 타일 이음매에 흰 홈이 세로로 생김.
- 원인: `drawHatchTile`이 선을 타일 밖으로 6px만 더 그어, 굵은 선은 네모난 끝의 모서리가 이음매 안쪽에 남음.
- 한 일: 타일 밖으로 긋는 거리를 가장 굵은 선의 반 굵기 + 휨 + 2px 이상(6px 단위, 최소 6px)으로 늘림. 지금 프리셋(굵기 4 이하)은 6px 그대로라 출력이 바뀌지 않음(스냅샷 그대로).
- 테스트: 타일의 마주 보는 가장자리에서 잉크가 같은지 검사(기본값, 굵기 12/간격 26). 고치기 전 굵은 쪽 17% 어긋남으로 실패, 고친 뒤 통과.
- 남은 일: 마커 굵기의 normal·bold 값 결정, 슬라이더 범위 확대(지금 굵기 8·간격 24까지).

## 빗금 프리셋 값 변경과 슬라이더 (2026-11-09, 사용자 요청)

- 정한 것 (사용자 결정, spec.md 반영):
  - 처음 기본값 1.9/6을 `fine`으로 옮기고, 옵션 없을 때의 기본은 `normal`로 한다.
  - `normal` 3/9(weightJitter 0.4), `bold` 4/12(0.5)는 임시 값이다.
  - 그래서 기본 빗금이 굵어지고, 기본 타일이 192px에서 198px(gap 9의 배수)가 된다.
- 한 일: 슬라이더 페이지 `npm run tune:hatch` → `.tuner/hatch.html`(git에서 제외).
  - 플러그인의 `drawHatchTile`·`HATCH_PRESETS`·옵션 검증을 브라우저용으로 묶어(tsup) 쓴다. 그래서 화면이 실제 출력과 같다.
  - 프리셋 버튼, 6개 옵션 슬라이더와 숫자 입력, 색, 타일 크기·잉크 비율·용량 표시, 잘못된 값의 오류 표시.
  - `HATCH_PRESETS`에 붙일 코드 한 줄과 플러그인 옵션 형태를 보여주고 복사할 수 있다.
  - 파일은 `test/tools/hatch-tuner/`(main.ts, page.html, build.mjs)다. Chromium·WebKit에서 조작해 동작을 확인했다.
- 기존 테스트 변경 (결정에 따른 것): 기본 타일 크기 테스트(192 → 198, fine 192 추가), 타일 SVG 크기, 출력 정규식의 `background-size`. hatch 스냅샷 갱신. 프리셋 측정 테스트는 표를 읽으므로 그대로 통과한다.

## 빗금 굵기 프리셋 (2026-11-09, M6b 뒤 사용자 요청)

- 한 일:
  - `hatch: 'fine' | 'normal' | 'bold'`, 그리고 `{ preset, ...숫자 }`.
  - `HATCH_PRESETS`(`src/options.ts`)의 처음 값은 fine 1.2/5, normal 1.9/6(기존 기본값), bold 3/9이다. 굵기/간격 순서이고, weightJitter는 굵기에 비례한다.
- 테스트: 사용자가 굵기·간격을 직접 조절할 수 있도록, 기대값을 표에서 읽는다.
  - 단위 테스트(`test/unit/options.test.ts`): 프리셋마다 이름으로 고르기, 자기 검증 통과, 바탕 위 덮어쓰기, 타일이 gap으로 나누어 떨어짐. 순서(fine < normal < bold), normal = 기본값.
  - 브라우저 테스트(`test/browser/hatch-presets.spec.ts`): 검은 빗금을 그려 실제 간격과 굵기를 잰다. 간격은 줄 중심 사이 거리의 중앙값, 굵기는 잉크 비율 × 간격 / √2다. 표와 비교해 간격 ±1px, 굵기 ±15% 안이면 통과.
    - 측정값을 출력한다: `npx playwright test hatch-presets --project=chromium --reporter=list`.
    - 음성 대조: 굵기를 두 배로 그리면 normal로 통과하지 않는다.
  - 측정 결과(Chromium·WebKit 같음): fine 5.00/1.20, normal 6.00/1.91, bold 9.00/3.00.
- 정한 것 (spec.md 반영): 프리셋 이름과 처음 값, `preset` 바탕 덮어쓰기.

## M6b 채움: 반복 빗금 (2026-11-08)

- 한 일:
  - `src/options.ts`: `hatch` 옵션(명세 표의 8개, 기본값, 범위 검증, 모르는 이름 오류). `ResolvedOptions.hatch`는 사용자가 줄 때만 있고 `hatchOf`로 기본값을 채운다(기존 옵션 테스트·타입 유지).
  - `src/draw/hatch.ts`(새 파일): 프로토타입 `penHatchTile` 이식(옵션 반영, seed 해시). 타일 크기 공식.
  - `src/gather/`: 결과에 빗금(`hatch`: 색, 조건별 색)을 테두리와 따로 더함. 테두리를 쓸 일이 없는 요소는 배경만(`paint`) 쓴다. 필요 판정이 빗금·되살릴 배경까지 비교한다. `hatch` 미지원 오류 제거.
  - `src/emit/`: 빗금 배경 선언, 조건 덮어쓰기(`background-image`만), 빗금 위치 고르기 규칙(빗금을 쓰는 파일에만).
  - 테스트:
    - 단위 테스트: 옵션 검증, 타일 크기·결정성·이음매(타일 오른쪽 끝의 선이 왼쪽 끝에서 이어짐), 출력·위치 규칙·hover·다크·옵션 반영·오류.
    - 새 예시 페이지 `test/pages/hatch/`.
    - 픽셀 테스트 `test/browser/hatch.spec.ts`: 빗금 잉크 비율(20~70%), 이음매 없음(큰 영역의 모든 열·행 잉크가 고름), 패딩 상자 안에서만(둥근 모서리 밖 포함), 이웃 위치 다름, hover·다크.
    - M4 오라클에 hatch 페이지 추가.
  - 발견해서 고친 것:
    - 사용자 정의 속성 `--skh`가 상속돼서, 순번상 위치 0인 요소가 부모의 위치를 물려받아 이웃과 같아졌다. 모든 요소에 기본값 규칙을 먼저 둔다.
    - 빗금 작업 중 필요 판정에 배경을 넣으면서, M6a에서 채움이 닿지 않는 요소에 불필요하게 넣던 `background-color` 되살리기를 없앴다. fills 스냅샷의 `.image` 한 줄이 이 때문에 바뀌었다.
  - 확인한 것: 1x·2x·4x에서 타일 이음매에 끊긴 열이 없다(축소한 스크린샷에서 보인 흐린 선은 축소 때문).
  - 용량: 타일 하나가 원본 25.4KB, gzip 9.4KB, brotli 6.9KB(기본 옵션, 색 하나).
- 기존 테스트 변경 (계획에 밝힘): "`hatch (not yet)` is an error"를 빗금 그리기 테스트로 바꿨다. 다른 기존 테스트·스냅샷은 그대로다(fills의 `.image` 한 줄은 위의 개선).
- 정한 것 (spec.md 반영): 출력 형태, 타일 크기·주기 공식, 이웃 변형(위치 이동 0/61/127), 옵션 형식과 범위.
- 남은 일: M6c(정밀 빗금, `--sketch-size`, `ends`·`over`), M6d(밑줄). 빗금 타일 용량은 M8 예산에서 다시 볼 것.

## M6a 채움: 거친 단색·형광펜 (2026-11-08)

- 한 일:
  - `src/read/values.ts`·`collect.ts`: `background` 단축 속성(색, 이미지 유무), `background-color`·`background-image`, `--sketch-fill`을 테두리 상태와 함께 접음. 배경만 바꾸는 규칙도 수집.
  - `src/draw/fill.ts`(새 파일): 거친 단색(`blob`)과 형광펜(`marker`) 이식. `Math.random` 대신 seed 난수. `src/draw/stroke.ts`: 9-slice SVG에 채움을 함께 그림, 형광펜 여백을 반영한 기하, 테두리 없는 채움의 작은 모서리 조각.
  - `src/gather/request.ts`: `paintRequestFor`(채움 요청, 이미지·그릴 수 없는 테두리면 채움 없음), 채움 `currentColor` 판정.
  - `src/gather/cascade.ts`·`gather.ts`:
    - 배경·`--sketch-fill`도 캐스케이드와 변수 해석에 넣음.
    - 묶음 구성원 판정(채움 묶음일 때만 배경 규칙 포함)과 부모 판정(채움 규칙) 확장.
    - 원래 배경 되살리기(쓴 그대로 `var(--fill)`).
    - 오류: 잘못된 값, `hatch` 미지원, 채움 `currentColor`.
  - `src/emit/emit.ts`·`src/index.ts`: `fill` 키워드, `background-color: transparent`, 되살리기, `--sketch-fill` 제거.
  - 테스트:
    - 단위 테스트: 배경 파싱, `paintRequestFor`, 채움 그리기, 출력·조합·오류.
    - 새 예시 페이지 `test/pages/fills/`.
    - 픽셀 테스트 `test/browser/fills.spec.ts`: 안쪽 칠함, 울퉁불퉁한 가장자리와 사라진 원래 사각형, 이웃 다름, 형광펜이 양 끝 밖으로 나가고 글자가 비침, hover 색, 원래 배경 되살림, 다크, 이미지 배경 그대로.
    - M4 오라클 확장: 계산된 배경색·배경 이미지·`--sketch-fill`(테스트에서만 `@property`로 상속 안 함)을 평탄화해 채움 요소 전체를 비교. fills 페이지와 hover 상태 추가. 음성 대조(플러그인 없으면 채움이 다름)도 추가.
  - 발견해서 고친 것: 테두리 없는 작은 요소(높이 12px 막대, 한 줄 글자 강조)에서 모서리 조각(14px × 2)이 요소보다 커 브라우저가 그림을 줄였다. 테두리 없는 채움은 모서리 조각을 채움 모서리만큼만 잡게 했다(spec 구현 주의점 추가).
  - 확인한 것: 테두리 없는 요소의 `border-image` 채움이 Safari(WebKit)에서도 그려진다.
- 기존 테스트 변경: 없음. 기존 페이지에는 `--sketch-fill`이 없어 모든 스냅샷이 그대로다(단색 = 원래 그대로).
- 정한 것 (spec.md·plan.md 반영):
  - M6을 M6a·M6b·M6c로 나누고 밑줄을 M6d로 옮김(사용자 결정).
  - 계획의 기본 동작 9가지: `--sketch-fill` 값과 규칙 단위, 채움 색, 원래 배경 덮기와 되살리기, 거친 단색·형광펜 모양(형광펜 바깥 6/2px, 불투명도 0.55), 테두리 없는 요소, 묶음 연결, 함께 그리지 않는 경우, 이웃 변형.
- 남은 일: 위 "다음에 할 일"의 M6b~M6d, 작은 요소의 거친 단색 두께, 채움 + 한 변 선.

## M5 한 변 선 (2026-11-08)

- 한 일:
  - `src/draw/stroke.ts`: `stripGeometry`(변별 slice·width·outset), `drawStrip`(프로토타입 `strip()` 이식, 가로·세로), 9-slice와 함께 쓰는 `ImagePlacement`. `src/draw/svg.ts`: `flipTransform`이 직사각형을 받음.
  - `src/gather/request.ts`: `StripRequest`, `stripRequestFor`(정확히 한 변, 닿는 모서리 각짐), `drawRequestFor`. `currentColor` 판정도 한 변까지.
  - `src/gather/cascade.ts`: `isSelfContained`(반쯤 정한 변 없이 한 변 이상 완성)로 부모 판정을 넓힘. 한 변 규칙의 상태·수정자(`.list li:hover { border-bottom-color }`)가 M4 방식으로 그려짐.
  - `src/emit/emit.ts`·`src/index.ts`: 그림 배치를 문자열로 일반화(9-slice 출력은 그대로), 요청 종류별 그리기.
  - 테스트:
    - 단위 테스트: `stripGeometry`, `drawStrip`, `stripRequestFor`, `isSelfContained`, 출력 형식과 hover 조합.
    - 새 예시 페이지 `test/pages/lines/`(긴 목록 20개, `hr`, 인용문 `border-left`, 탭, 여러 줄 링크, hover, 다크).
    - 픽셀 테스트 `test/browser/lines.spec.ts`: 끝까지 닿음, 이어짐, 다른 변 비어 있음, 이웃 다름, 링크 줄마다 선, hover·다크 색.
    - 음성 대조: 양 끝 고정 없이 통째로 늘이면 끝까지 닿음 검사가 실패한다(명세의 "13px씩 짧아짐").
    - M4 오라클이 boxes의 한 변 선도 비교한다.
  - 발견해서 고친 것: 높이 2px `hr`에서 그림 영역(요소 + outset)이 그림 두께보다 작아 브라우저가 그림을 줄여 선이 가늘어지고 3px 위로 밀렸다. 그림 없는 반대쪽에 그림 두께만큼 outset을 더 줘서 해결했다(spec 구현 주의점에 추가).
  - 확인한 것: `hr`의 브라우저 기본 `overflow: hidden`은 `border-image`를 자르지 않는다(Chromium·WebKit). `overflow: visible`은 넣지 않았다.
- 기존 테스트 변경 (계획에 밝힘): "그리지 않는 CSS" 목록의 `(M5)` 두 항목을 옮겼다. 한 변 선은 그리기 테스트로, 한 변 `currentColor`는 오류 테스트로 갔다. 대신 두세 변과 둥근 끝 한 변을 그대로 두는 항목에 추가했다. boxes 스냅샷은 `.link`·`.list li`·`.rule`만 바뀐 것을 확인하고 갱신했다.
- 정한 것 (spec.md·plan.md 반영):
  - 범위는 한 변 border와 `hr`. `text-decoration` 밑줄은 M6 다음 단계(plan.md에 M6b로 추가)로 옮겼다(사용자 결정).
  - 두세 변은 원래 CSS로 둔다(사용자 결정).
  - 한 변 정의, 닿는 모서리 조건, 부모 확장, 이웃 변형 적용, 사용자 CSS의 `hr`만.
- 남은 일: 위 "다음에 할 일"의 M6·M6b, 두세 변, 짧은 요소.

## M4 캐스케이드 (2026-11-08)

- 한 일:
  - `src/read/selectors.ts`(postcss-selector-parser, 셀렉터 글자만 읽음): 목록 나누기, 앞 문맥·마지막 복합 셀렉터·가상 요소·우선순위, 포함 관계와 합치기, CSS 중첩(`&`) 풀기.
  - `src/read/collect.ts`: 셀렉터 항목, 소스 순서, at-rule 사슬, 부분 규칙 판정.
  - `src/gather/cascade.ts`: 규칙×셀렉터 단위(item), 부모 판정과 묶음, 요소별 캐스케이드(중요도→우선순위→순서, 사용자 정의 속성 포함), 결과(그림·원래 테두리·그대로).
  - `src/gather/combos.ts`: 이기는 그림 찾기, 조합 필요 판정, 부분집합 나열.
  - `src/gather/gather.ts`: 규칙별 그림 + 필요한 조합 규칙, 오류(부모 없음, `:is()`, 상한 16, 클래스 테마).
  - `src/gather/request.ts`: 기존 판정 함수 이동, radius 상한 32px.
  - `src/emit/emit.ts`: 규칙 안 쓰기, 규칙 뒤 새 규칙(조건 감싸기, 중첩 규칙은 바깥 규칙 뒤, 순서 유지), 원래 테두리 보여주기.
  - 린트: read/에서 postcss-selector-parser 사용 허용. 단 파서에 셀렉터 글자만 넘기도록(`String(...)`, 문자열, 템플릿) 막는다. 규칙 노드를 넘기면 파서가 `rule.selector`를 바꾸기 때문이다(사용자 결정 A안).
  - 테스트:
    - 단위 테스트: `test/unit/selectors.test.ts`, `test/unit/cascade.test.ts`, plugin.test.ts의 M4 묶음(조합 위치·조건·문맥·`!important`·목록 나누기·변수 수정자·중첩·오류·fixture 위치). `lint-rules.test.ts`는 위 린트 변경에 맞춤.
    - 브라우저 오라클 `test/browser/cascade.spec.ts`(Chromium, WebKit):
      - 원래 CSS로 렌더링해 브라우저가 계산한 테두리를 요소별 `!important` 완성 규칙으로 만들고, 그 그림과 변환 결과를 테두리 띠의 픽셀로 비교한다.
      - 대상: design-system·boxes·forms 페이지, 기본·넓은 화면·다크·hover·키보드 focus 상태.
      - 음성 대조 3개: 플러그인 없음, 상태 × 크기 조합 없음, `@media` 안 조합 없음. 모두 실패로 잡힌다.
  - 테스트 페이지: boxes는 부모를 셀렉터에 넣은 형태(`.box.w2`)로 고침(부모 없는 `.w2`는 이제 오류). 레이아웃 음성 대조의 추가 CSS도 `.box.w1`로 맞춤. design-system "기대" 주석에 상태·`@media` 조합을 반영. 다크 모드 레이아웃에 design-system 추가.
- 기존 테스트 변경 (계획에 밝힘 + 결정에 따른 것):
  - "그리지 않는 CSS" 목록의 부분 규칙 두 항목을 오류 테스트로 옮겼다. 한 변 `currentColor`와 모서리만인 규칙은 그대로 두는 항목에 남겼다.
  - M3 클래스 테마 테스트의 `.a.big { --c }`는 결정 7번(셀렉터에 부모가 있는 수정자의 변수 허용)에 따라 오류가 아닌 것으로 바꿨다. `html.dark`·`.x`는 여전히 오류다.
  - 스냅샷: forms(`.field:focus`), boxes, design-system이 의도대로 바뀐 것을 그림을 가린 diff로 확인하고 갱신했다. sketch·neighbors·theme·mega-menu·tooltip은 그대로다.
- 정한 것 (spec.md 반영):
  - 원칙 "원래 CSS가 낼 결과를 그린다"와 조합(상태·`@media` 포함).
  - 부모 없는 부분 규칙은 모두 오류(이름 무관). 자손 결합자는 받아온다. 목록은 나눠 처리, 후보 여럿인 `:is()`는 오류. 변수 수정자 허용.
  - 기본 동작: 부분 규칙 정의, 부모 판정, 조합 위치·우선순위·`!important`, 그릴 수 없는 조합은 원래 테두리, 목록 나누기, 상한 16.
  - radius가 32px보다 크면 원래 테두리로 보여준다(사용자 결정, M1의 "크기와 상관없이 그린다"를 고침).
- 남은 일 / 알려진 한계: 위 "다음에 할 일"의 M4 한계, 조합 용량, select radius(M7).

## M3 색 해석 (2026-11-08)

- 한 일:
  - `src/read/variables.ts`: 파일 안 사용자 정의 속성 정의(루트 여부, `@media`·`@supports` 조건 사슬). `src/read/collect.ts`: 규칙의 선언 원문, `--sketch` 제어.
  - `src/gather/colors.ts`:
    - `var()` 치환(대체값, 중첩, 순환 감지)
    - 기본·조건별 환경
    - 오류 메시지 5종(currentColor, 못 찾는 변수·순환, 클래스 테마, 조건에서 그릴 수 없음, 잘못된 `--sketch`)
  - `src/gather/gather.ts`: 테두리 선언의 변수를 풀고 다시 접어 판정, 조건 변형 요청, `currentColor`는 "색만 알면 그릴 수 있는 규칙"일 때만 오류.
  - `src/emit/emit.ts`: 그린 규칙 바로 뒤에 조건 덮어쓰기 규칙(원래 규칙의 줄바꿈·들여쓰기를 따름), `--sketch` 선언 제거.
  - 오류 보고: 위치가 첫 오류를 가리키고(이전에는 파일 1:1), 여러 개면 `오류 N개`와 각 `줄:열`.
  - 테스트:
    - 단위 테스트: `test/unit/colors.test.ts`, plugin.test.ts의 M3 묶음(출력 모양, 조건 변형의 색, 오류 메시지 내용, `--sketch`).
    - 새 예시 페이지 `test/pages/theme/`.
    - 픽셀 테스트 `test/browser/theme.spec.ts`: 밝은·다크 색, 두 모드의 모양이 같음, 규칙 자신의 변수가 테마를 이김, 두 모드의 hover 색.
    - 다크 모드 레이아웃 비교.
    - 잉크 헬퍼는 `test/browser/lib/ink.ts`로 옮겨 neighbors와 같이 씀.
    - 모양 비교는 색과 상관없는 "채도 있는 잉크"로 한다. 색상별 판별은 연한 가장자리를 다른 비율로 놓쳐 같은 모양도 0.10~0.11로 나왔다.
    - 음성 대조: 다크 덮어쓰기만 다른 칸을 쓰게 바꾸면 0.42로 실패한다.
  - 기존 테스트: "그리지 않는 CSS" 목록의 `(M3)` 두 항목을 계획대로 오류 테스트로 옮김. 부분·한 변 `currentColor`와 테두리 없는 미해결 변수는 그대로 두는 항목으로 추가. 기존 스냅샷은 바뀌지 않음.
- 정한 것 (spec.md 반영): 규칙 자신의 변수는 쓰고 다른 클래스 규칙이 바꾸면 오류(사용자 결정), 루트 규칙 정의, 조건 변형 출력, 변수 해석 범위, 오류 조건과 메시지 내용, `--sketch: off`.
- 계획과 다르게 한 것: `Color`에 새 종류를 더하는 대신 `isCurrentColor`로 판별(기존 값·판정 테스트가 `currentColor`를 `unknown`으로 기대해서, 동작은 같고 테스트를 바꾸지 않으려고). `requestFor`도 시그니처를 유지하고 `currentColor` 판정은 따로 함.
- 남은 일 / 알려진 한계: 위 "다음에 할 일"의 M4, 색 해석의 한계.

## M2 이웃 변형 (2026-11-08)

- 한 일:
  - 그림마다 seed 3개(11·23·37) × 뒤집기 4방향(원본·좌우·상하·둘 다) = 12장. 뒤집기는 SVG 안 `<g transform>`이라 경로 데이터가 같다(`src/draw/svg.ts` `FLIPS`·`flipTransform`).
  - 그림 변수 중복 제거: 파일 맨 앞 `:root`에 그림을 한 번씩, 이름은 그림 내용의 FNV-1a 해시(`src/draw/hash.ts`).
  - 고르는 규칙 22개(`src/emit/variants.ts`): 기본값, 자기 순번 mod 4 뒤집기, (자기+부모+조부모 순번) mod 3 seed. 모두 `:where()`라 우선순위 0. 그리는 규칙은 칸 변수 12개를 채우고 `border-image: var(--sk)`로 그린다(`src/emit/emit.ts`).
  - 가상 요소 규칙 판별(`targetsPseudoElement`, `src/read/collect.ts`)과 고정 그림.
  - 테스트:
    - 단위 테스트(`test/unit/variants.test.ts`): FNV 표준 값, 뒤집기 경로 동일, 섞기 표, 넣는 위치, 공유, 가상 요소, 파일 간 이름 충돌 없음.
    - 새 예시 페이지 `test/pages/neighbors/`.
    - 픽셀 테스트 `test/browser/neighbors.spec.ts`: 형제끼리 다름, 다른 부모 아래 같은 순번끼리 다름, 12개 형제에서 6종 이상, hover 때 모양 같고 색만 바뀜, `::before` 그려짐.
    - 음성 대조로 픽셀 테스트가 실제로 잡는지 확인했다:
      - 모든 요소에 같은 그림을 쓰게 바꾸면 차이 테스트 3개가 실패한다(같은 그림의 차이는 약 0.01, 기준 0.1).
      - hover만 다른 칸을 쓰게 바꾸면 모양 테스트가 실패한다(0.50).
  - 기존 테스트: plugin.test.ts의 출력 형식 테스트 4개를 같은 의도로 새 형식에 맞춤(사용자 확인. 계획에는 1개로 적었으나 형식 때문에 4개가 깨짐). 스냅샷은 그림을 가리고 diff를 확인한 뒤 갱신(그린 규칙의 `url()`→`var(--sk)`와 칸 변수, 맨 앞 블록만 바뀜. slice·outset 값은 그대로).
- 정한 것 (spec.md 반영):
  - 출력 구조, 섞는 공식, 변수 이름(해시), 가상 요소 예외, `!important`는 칸 변수에도, 그린 규칙이 없으면 아무것도 덧붙이지 않음.
  - 뒤집기 용량 측정(5페이지 합계, brotli): 그림 1장 5.3KB, seed 3장 10.6KB, seed 3×뒤집기 4 13.5KB(seed 3장 대비 +27%, sketch 페이지는 +42%). 사용자 결정으로 4방향 유지. 미정 항목 체크.
  - "구현 주의점"에 파일 간 변수 이름 충돌 추가.
- 남은 일 / 알려진 한계: 위 "다음에 할 일"의 이웃 변형 확대(M5·M7), 가상 요소 반복, 칸 변수 용량.

## M1 단일 규칙 테두리 (2026-11-08)

- 한 일:
  - 처리 단계별 모듈: `src/options.ts`(프리셋, 숫자 보간, 검증), `src/read/values.ts`(테두리·radius·색 값 파싱, postcss-value-parser), `src/read/collect.ts`(규칙의 선언을 순서대로 접어 네 변 상태로), `src/gather/gather.ts`(규칙 하나 = 요소 하나, 그림 요청 또는 건너뜀), `src/draw/svg.ts`·`src/draw/stroke.ts`(9-slice, 시안 `nineSlice` 이식), `src/emit/emit.ts`, `src/report/diagnostics.ts`(`{ value, diagnostics }`). index.ts가 단계를 잇고, 같은 그림 요청은 파일 안에서 한 번만 그린다.
  - 의존성: `roughjs`, `postcss-value-parser`.
  - 테스트: 값 파싱·옵션·그리기·판정·출력 단위 테스트, 그리지 않는 CSS가 그대로 나오는지, 결정성. 새 예시 페이지 `test/pages/sketch/`와 픽셀 테스트 `test/browser/sketch.spec.ts`(원본과 다름, 네 변 가운데 80%에 잉크가 이어짐, 안쪽에 잉크 없음, 둥근·각진 모서리, 완성된 `:hover` 규칙이 자기 그림으로 바뀜, `border` 단축 속성이 겹쳐도 그림 유지). 기존 페이지 스냅샷은 그린 규칙만 바뀐 것을 확인하고 갱신.
  - M0의 "빈 플러그인은 CSS를 그대로 둔다" 테스트는 M1 동작("그리지 않는 CSS는 그대로 둔다")으로 대체.
  - ESLint 노드 수정 메서드 목록에 `after`·`before` 추가.
- 정한 것 (spec.md 반영):
  - 그리는 테두리와 그대로 두는 테두리 표, 출력 형태, 숫자 거칠기의 선형 보간.
  - 못 그리는 규칙은 M1에서 조용히 넘김. 오류·경고는 M3·M4·M8.
  - 색은 원래 선언의 색 토큰을 고치는 대신, 마지막 테두리 선언 뒤에 `border-color: transparent`를 덧붙여 덮는다(원래 색이 출력에 남아 읽기 쉽고, 단축 속성 파싱 실수가 출력에 번지지 않음).
  - 두꺼운 선(약 8px 이상)은 선이 SVG 밖으로 잘리지 않도록 여백을 늘려 `border-image-outset`이 음수가 되지 않게 함.
  - seed는 11 하나 (M2에서 3개로).
- 남은 일 / 알려진 한계: 위 "다음에 할 일"의 M4·radius·작은 요소·단위 항목.

## M0 준비 (2026-11-08)

- 한 일:
  - git 저장소, `package.json`(ESM, `engines: node >=20`, ESM·CJS `exports`, `postcss` peer), `tsconfig.json`(`strict`, `noUncheckedIndexedAccess`), `tsup.config.ts`(ESM·CJS·d.ts, CJS에서 `require()`가 바로 플러그인을 돌려줌), `vitest.config.ts`, `playwright.config.ts`(chromium, webkit), `eslint.config.js`, `.github/workflows/ci.yml`.
  - `src/index.ts`: 빈 플러그인(옵션을 받고 CSS를 바꾸지 않음).
  - 테스트용 페이지 `test/pages/`: `boxes`(두께 1·2·4, 각진·둥근, 그리드·플렉스·인라인, 한 변, hr, 밑줄 링크, 원), `mega-menu`, `tooltip`(compare-a 시안의 시나리오), `forms`.
  - `npm test`: 플러그인 형태, 빈 플러그인이 CSS를 그대로 두는지, 페이지별 출력 스냅샷(`test/snapshot/__snapshots__/`), ESLint 규칙이 폴더별로 걸리는지(`test/unit/lint-rules.test.ts`).
  - `npm run test:browser`: 원본 CSS와 변환 CSS로 같은 HTML을 렌더링해 모든 요소의 사각형·줄 상자·문서 스크롤 크기를 오차 0으로 비교. `data-hit` 요소는 `elementFromPoint`로 맨 위에 있는지도 비교. 음성 대조 3개(테두리 1px 증가, `position: relative`로 메가 메뉴가 줄어듦, `isolation: isolate`로 툴팁이 가려짐)가 실제로 실패로 잡히는지 확인. 픽셀 헬퍼(`test/browser/lib/pixels.ts`, measure.py에서 옮김)를 색을 아는 페이지로 검증.
- 정한 것:
  - 지원 Node 20 이상 (spec.md에 반영). 그래서 개발 도구도 Node 20에서 도는 버전으로 고정: tsup 8, vitest 4, TypeScript 5.9 (tsup 9·vitest 5는 Node 22 이상만 지원, typescript-eslint는 TypeScript 6.1 미만만 지원).
  - CI는 최소: Node 20, `npm ci` → `npm run lint` → `npm test` → 브라우저 설치 → `npm run test:browser`. 캐시·매트릭스·배지 없음.
  - CLAUDE.md 코딩 컨벤션을 ESLint로 강제. `npm run lint`(tsc + eslint)를 완료 기준에 추가(CLAUDE.md 반영).
    - `src/`, `test/`: `func-style: expression`, `function` 선언·표현식·메서드 단축 문법·`class` 금지, default export 금지(`src/index.ts`만 예외), `prefer-const`.
    - `src/`: `Math.random`, `Date` 금지. `src/index.ts`·`src/cli.ts` 밖에서는 `console`, `process`, `fs`·`readline` import 금지.
    - `src/read|gather|draw/`: `postcss`·`postcss-selector-parser`는 `import type`만, PostCSS 수정 메서드(`append`, `remove`, `replaceWith` 등) 호출 금지, 매개변수 속성 대입 금지(`no-param-reassign` props). 지역 변수 변경은 허용.
    - `switch`의 `never` 검사는 `@typescript-eslint/switch-exhaustiveness-check`(타입 정보 사용).
  - 플러그인 객체는 메서드 단축 문법 대신 `Once: (root) => { … }`처럼 화살표 함수 속성으로 쓴다(위 규칙의 결과).
- 남은 일 / 알려진 한계:
  - PostCSS 노드 수정 금지는 메서드 이름과 매개변수 대입으로만 막는다. 노드를 지역 변수에 담아 속성을 바꾸거나(`const d = decls[0]; d.value = …`), 다른 이름의 수정 함수를 거치면 잡지 못한다. `readonly` 타입으로 보완할 것.
  - `readonly`·`ReadonlyArray` 사용, 오류를 값으로 돌려주는 규칙은 린트로 강제하지 않는다(리뷰로 확인).
  - 실제 CI 실행은 원격 저장소 연결 후 확인.
