# M4 캐스케이드 테스트 입력

`test/pages/design-system/`은 명세가 결과를 정한 경우만 담은 예시 페이지다. 각 규칙의 "기대" 주석이 M4가 내야 할 결과다. 이 폴더는 오류가 나야 하는 입력을 담는다. M4 전에 미정이던 경우(상태·`@media` × 수정자, 자손 결합자, `:is()`, 부모 없는 규칙, 변수 수정자 등)는 결정되어 docs/spec.md "여러 규칙에 걸친 테두리"로 옮겼다.

## 오류가 나야 하는 입력 (명세로 정해짐)

| 파일 | 경우 | 기대 |
| --- | --- | --- |
| `name-only-width.css` | `.btn--large { border-width }`, 셀렉터에 `.btn` 없음 | 컴파일 오류, 9:23, 해결책 세 가지(셀렉터에 부모, 속성 모두 쓰기, `--sketch: off`) 안내 |
| `name-only-color.css` | `.card--active { border-color }` | 컴파일 오류, 6:17 |
