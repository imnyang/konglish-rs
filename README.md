# https://github.com/oyc0401/konglish

# Konglish

영어/외래어 문장을 한국어 발음 표기로 바꿔주는 Rust 라이브러리입니다.

~~간단하게 쓸 곳이 있어서 Codex로 작성되었습니다.~~

## 사용법

```rust
use konglish::latin_to_hangul_default;

let out = latin_to_hangul_default("pretender");
assert_eq!(out, "프리텐더");
```

커스텀 사전:

```rust
use konglish::{latin_to_hangul, Dictionary, LatinToHangulOptions};

let mut dictionary = Dictionary::new();
dictionary.insert("latte".to_string(), vec!["라떼".to_string()]);

let options = LatinToHangulOptions {
    dictionary,
    ..Default::default()
};

assert_eq!(latin_to_hangul("latte", Some(&options)), "라떼");
```

내장 사전은 `src/dictionary.rs`의 `CUSTOM_DICTIONARY`에 추가합니다.

```rust
dictionary! {
    "a": ["어"],
    "aaron hank": ["에런 행크"],
}
```

## 라이선스

[MIT](./LICENSE)
