# 시안 코드

명세를 정하면서 만든 데모의 생성 스크립트다. 실제 구현의 참고용이며, 패키지에 그대로 포함하지 않는다. 실행하려면 `roughjs`가 필요하다.

| 파일 | 내용 | 참고할 부분 |
| --- | --- | --- |
| `fills.mjs` | 채움 그리기 함수 모음 | 거친 단색(`blob`), 형광펜(`marker`), 필압 빗금 무늬(`penHatchTile`), 정밀 빗금(`exactHatch`) |
| `showcase/` | 메인 예시 페이지 생성기 | 9-slice 테두리(`nineSlice`), 한 변 선(`strip`), 체크박스·라디오·아바타·밑줄·화살표, 순번 섞기 규칙 |
| `fill/` | 채움 비교 페이지 생성기 | 채움 방식별 적용 방법 |
| `compare-a/` | 현재 방식 vs A 방식 비교 | A 방식(`border-image`)의 출력 형태, 테두리+채움 합친 SVG(`nine`) |
| `edge-tests/` | 경계 테스트 페이지와 측정 스크립트 | `measure.py`: Playwright로 픽셀을 읽어 판정하는 방법 |

주의: `showcase/`와 `fill/`은 A 방식으로 정하기 전에 만들어서, 테두리를 가상요소 + mask로 그린다. 그리는 함수(SVG를 만드는 부분)는 그대로 유효하지만, CSS를 적용하는 방식은 `compare-a/`의 A 방식을 따른다.

각 `gen.mjs`는 원래 저장소 구조(`../fills.mjs`, `node_modules/roughjs`)를 가정하고 있다.
