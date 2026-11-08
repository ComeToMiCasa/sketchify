# postcss-sketchify

평범한 CSS를 레이아웃은 그대로 두고 손그림 스타일로 바꾸는 PostCSS 플러그인.

- 명세: docs/spec.md (무엇을 만드는가. 기준 문서)
- 구현 계획: docs/plan.md (모듈 구조, 마일스톤 M0~M9)
- 진행 상황: docs/progress.md (지금 어디까지 했는가)
- 시안 코드: prototypes/ (그리기 함수와 측정 스크립트의 참고용. 그대로 import하지 말고 옮겨서 다시 쓴다)

## 명령

- `npm run lint`: 타입 검사(tsc) + ESLint (아래 코딩 컨벤션 강제)
- `npm test`: 단위 테스트 + 출력 스냅샷 + 린트 규칙 검사
- `npm run test:browser`: 레이아웃 불변, 픽셀 테스트 (Playwright, Chromium과 WebKit)
- `npm run build`: 패키지 빌드

## 규칙

- 핵심 약속: 변환 전후 모든 요소의 위치와 크기가 같아야 한다. 이걸 깨는 변경은 어떤 이유로도 하지 않는다.
- 완료라고 말하기 전에 `npm run lint`, `npm test`, `npm run test:browser`를 모두 통과시킨다.
- 테스트를 통과시키려고 테스트를 고치지 않는다. 테스트가 틀렸다고 판단되면 멈추고 묻는다.
- 명세에 없는 동작을 정해야 하면 지어내지 말고 멈추고 묻는다. 정해진 내용은 docs/spec.md에 반영한다.
- 한 번에 마일스톤 하나만 진행한다. 범위 밖 작업은 docs/progress.md의 "다음에 할 일"에 적는다.
- 마일스톤이 끝나면 docs/progress.md에 한 일, 정한 것, 남은 일을 적는다.
- docs/spec.md의 "구현 주의점" 표는 실제로 겪은 버그 목록이다. 관련 코드를 쓸 때 먼저 읽는다.

## 코딩 컨벤션

TypeScript, 함수형 스타일. 아래 규칙은 ESLint로 강제한다.

- 함수는 `const f = (...) => ...` 형식으로만 쓴다. `function` 선언과 `class`는 쓰지 않는다.
- 순수한 핵심, 부수효과는 가장자리:
  - `read/`, `gather/`, `draw/`는 순수 함수만. 입력을 바꾸지 않고, PostCSS 노드를 수정하지 않는다.
  - PostCSS AST 수정은 `emit/`에서만, 파일·콘솔 입출력은 `cli.ts`와 `index.ts`에서만.
- 불변 데이터: 타입은 `readonly`, 배열은 `ReadonlyArray`, 변수는 `const`.
  - 예외: `draw/`의 좌표 계산처럼 숫자 루프가 더 읽기 쉬운 경우, 함수 안에서만 쓰는 지역 변수는 바꿔도 된다. 밖으로 새지 않으면 된다.
- 데이터는 `type`으로 정의한다. 종류가 갈리는 값(채움 방식, 테두리 변 등)은 판별 유니온으로 만들고, `switch`는 `never` 검사로 빠짐없이 처리한다.
- 오류는 던지지 않고 값으로 돌려준다. 핵심 함수는 `{ value, diagnostics }`를 반환하고, 컴파일 오류로 실패시키는 건 `index.ts`에서 진단을 모아 한 번에 한다.
- 결정적 출력: `Math.random`, `Date`는 쓰지 않는다. 난수는 seed가 있는 생성기만 쓴다.
- export는 이름 있는 export만 쓴다. PostCSS가 요구하는 플러그인 진입점만 default export.
- fp-ts 같은 함수형 라이브러리는 쓰지 않는다. 표준 TypeScript로 충분하다.
- tsconfig는 `strict`와 `noUncheckedIndexedAccess`를 켠다.