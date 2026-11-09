import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeQoderBase64, encodeQoderBase64 } from "./qoder-base64.ts";

/**
 * 参考向量来自 qoder2api-hub 的 Python 实现（qoder_sign.qoder_encode）：
 * 字母表与三段轮转任何一处写错，这些值都会变，上游就会按「body 非法」拒绝。
 */
const VECTORS = [
  ["{}", "$kwm"],
  ["hi", "$HzP"],
  ['{"a":1}', "ep$$BMn%mYKi"],
  ["abcdefghijklmnopqrstuvwxyz0123456789", "mxnfV@B^jRa(j^&QuSQbNZgYNkC.JEJI#SKMDHFOD(i)POtr"],
  ["x", "$_$m"],
];

test("encodeQoderBase64 与官方实现逐字节一致", () => {
  for (const [plain, encoded] of VECTORS) {
    assert.equal(encodeQoderBase64(plain), encoded, `encode mismatch for ${JSON.stringify(plain)}`);
  }
});

test("decodeQoderBase64 是 encode 的逆运算", () => {
  for (const [plain] of VECTORS) {
    assert.equal(new TextDecoder().decode(decodeQoderBase64(encodeQoderBase64(plain))), plain);
  }
  // 长度覆盖三种 padding 形态（0/1/2 个 '='）。
  for (const length of [1, 2, 3, 4, 5, 6, 17, 64, 1000]) {
    const plain = "a".repeat(length);
    assert.equal(new TextDecoder().decode(decodeQoderBase64(encodeQoderBase64(plain))), plain);
  }
});

test("encodeQoderBase64 处理含多字节字符的 JSON", () => {
  const body = JSON.stringify({ text: "你好 Qoder CN" });
  assert.equal(new TextDecoder().decode(decodeQoderBase64(encodeQoderBase64(body))), body);
});
