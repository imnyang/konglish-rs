# Konglish - 영어 한국어 발음 변환기

영어/외래어 문장을 한국어 발음 표기로 바꿔주는 TypeScript 라이브러리입니다.    
영어는 발음매칭이 어렵기 때문에, 커스텀 사전을 사용해서 매칭했습니다.
사전에 없는 단어라면 그대로 유지되니 필요한 항목을 사전에 채워 넣어 주세요.

## 설치

```bash
pnpm add konglish
# 또는
npm install konglish
yarn add konglish
```

## 사용법

### 간편 호출

```ts
import { latinToHangul } from "konglish";

latinToHangul("good morning"); // "굿 모닝"
latinToHangul("coffee time"); // "커피 타임"
latinToHangul("family vacation"); // "패밀리 베케이션"
latinToHangul("weekend movie night"); // "위켄드 무비 나이트"
latinToHangul("happy birthday"); // "해피 버스데이"
latinToHangul("pizza party"); // "피자 파티"
latinToHangul("music festival"); // "뮤직 페스티벌"
latinToHangul("new project"); // "뉴 프로젝트"
latinToHangul("thank you"); // "땡큐"
latinToHangul("see you soon!"); // "씨 유 순!"
```

### 클래스 호출

```ts
import { Konglish } from "konglish";

const konglish = new Konglish({
  dictionary: {
    latte: ["라떼"],
    meetup: ["밋업"],
  },
});

const sync = konglish.latinToHangul("latte meetup"); // "라떼 밋업"
const asyncOut = await konglish.latinToHangulAsync(
  "latte meetup xylophone",
); // "라떼 밋업 xylophone"
```

`latinToHangulAsync`는 Promise를 반환하므로 비동기 코드에서 `await`로 호출할 수 있습니다.


## 라이선스

[MIT](./LICENSE)
