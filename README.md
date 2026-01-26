# Konglish - 영어 한국어 발음 변환기

영어/외래어 문장을 한국어 발음 표기로 바꿔주는 TypeScript 라이브러리입니다.    
영어는 발음매칭이 어렵기 때문에, 커스텀사전을 사용해서 매칭했습니다.
사전에 없는 단어라면, cmu-pronouncing-dictionary를 사용해 한국어 발음으로 변환했습니다.

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

konglish.latinToHangul("latte meetup"); // "라떼 밋업"
konglish.latinToHangul("simple lunch menu"); // "심플 런치 메뉴"
```


## 라이선스

[MIT](./LICENSE)
