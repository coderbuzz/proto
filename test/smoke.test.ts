import { test, expect } from "bun:test";
import { proto } from "@coderbuzz/proto";
import { object, string, number } from "@coderbuzz/veta";

test("proto encode/decode object", () => {
  const schema = object({ name: string(), age: number() });
  const codec = proto(schema);
  const val = { name: "Alice", age: 30 };
  const encoded = codec.encode(val);
  expect(codec.decode(encoded)).toEqual(val);
});