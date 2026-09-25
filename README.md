<!-- docs: sync from coderbuzz/codex@eeb7661 -->

# Proto: `@coderbuzz/proto`

> **Binary serialization for TypeScript. Smaller than Protobuf. No `.proto` files. Zero per-field overhead.**
> AI agents: see [AI_KNOWLEDGE.md](https://github.com/coderbuzz/proto/blob/main/AI_KNOWLEDGE.md) for expert context.
<p align="center">
  <a href="https://www.npmjs.com/package/@coderbuzz/proto"><img src="https://img.shields.io/npm/v/@coderbuzz/proto.svg?style=flat-square" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@coderbuzz/proto"><img src="https://img.shields.io/npm/dm/@coderbuzz/proto.svg?style=flat-square" alt="npm downloads" /></a>
  <a href="https://github.com/coderbuzz/proto/blob/main/LICENSE"><img src="https://img.shields.io/github/license/coderbuzz/proto.svg?style=flat-square" alt="MIT License" /></a>
  <a href="https://github.com/coderbuzz/proto"><img src="https://img.shields.io/github/stars/coderbuzz/proto.svg?style=flat-square" alt="GitHub Stars" /></a>
  <a href="https://github.com/coderbuzz/proto/actions/workflows/ci.yml"><img src="https://github.com/coderbuzz/proto/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://codecov.io/gh/coderbuzz/proto"><img src="https://codecov.io/gh/coderbuzz/proto/graph/badge.svg" alt="Codecov" /></a>
</p>

Proto compiles high-performance binary codecs from `@coderbuzz/veta` schema validators at **runtime**. Since the schema is known at both ends, the wire format contains **no field names, no type tags, and no per-field headers**, just pure payload data.

The result: **structured data smaller than Protobuf, smaller than MessagePack, and dramatically smaller than JSON**, with full TypeScript type safety.

---

## Why Proto over Standard Protobuf, MessagePack, or BSON?

| Pain Point | Standard Protobuf | MessagePack | BSON | **@coderbuzz/proto** |
|---|---|---|---|---|
| Schema definition | `.proto` files + codegen | None (self-describing) | None (self-describing) | **TypeScript validators** (`@coderbuzz/veta`): no build step |
| Per-field overhead | Tag + wire type + value | Type tag per value | Type tag + field name | **Zero**: no metadata per field |
| Wire format size | Medium (tags add bytes) | Large (type tags) | Large (field names) | **Smallest**: pure payload |
| Schema evolution | Designed for | N/A | N/A | Not supported (both ends must match) |
| Runtime compilation | Build-time codegen | Runtime | Runtime | **Runtime**: compile from schema metadata once |
| Union / `oneof` | Tag-based | No | No | **1 byte variant index** + value |
| TypeScript integration | External `.d.ts` | Manual | Manual | **Native**: types from veta validators |
| Pre-calculate size | Manual | No | No | **`size()`**: exact bytes without encoding |

---

## How It Differs From Standard Protobuf

| Feature | Standard Protobuf | `@coderbuzz/proto` |
|---|---|---|
| Schema definition | `.proto` files + codegen | TypeScript validators (`@coderbuzz/veta`) |
| Field encoding | Tag + wire type + value (varint prefixed) | Value only: no tags, no wire types |
| Field order | Field number order | Schema key order (deterministic) |
| Codec timing | Build-time codegen | Runtime compilation from schema metadata |
| Unknown fields | Skipped during decode | Not applicable (schema required at both ends) |
| Union / `oneof` | Tag-based with explicit oneof wrapper | 1-byte variant index + value |
| `literal` encoding | Encoded as field value | **0 bytes**: value known from schema |

---

## Benchmarks

Full results at **[github.com/coderbuzz/benchmarks](https://github.com/coderbuzz/benchmarks)**.

All tests on Apple M-series, Bun runtime.

### Wire Size (nested object)

| Format | Bytes | vs JSON |
|---|---|---|
| **@coderbuzz/proto** | **65** | **53% smaller** |
| @coderbuzz/msgpack | 111 | 20% smaller |
| JSON | 139 | baseline |

### Encode Throughput (nested object)

| Library | Ops/s | Factor |
|---|---|---|
| JSON.stringify | 6,892,630 | 1.0x |
| **@coderbuzz/proto** | **4,694,891** | **1.5x slower** |
| @coderbuzz/msgpack | 3,275,386 | 2.1x |
| @msgpack/msgpack | 1,323,117 | 5.2x |

### Decode Throughput (nested object)

| Library | Ops/s | Factor |
|---|---|---|
| JSON.parse | 3,320,669 | 1.0x |
| **@coderbuzz/proto** | **3,109,557** | **1.1x slower** |
| @coderbuzz/msgpack | 1,231,876 | 2.7x |
| @msgpack/msgpack | 1,086,271 | 3.1x |

> Proto prioritizes **wire size** over raw throughput. Compared to JSON, payloads are 53% smaller for only 1.1–1.5x encode/decode overhead. Compared to other binary formats like MessagePack, proto is both **smaller and faster**.

---

## Installation

```sh
# npm
npm install @coderbuzz/proto @coderbuzz/veta

# Bun
bun add @coderbuzz/proto @coderbuzz/veta

# Deno
import { object, string, number } from "npm:@coderbuzz/veta";
import { proto } from "npm:@coderbuzz/proto";
```

---

## Quick Start

```ts
import { object, string, number } from "@coderbuzz/veta";
import { proto } from "@coderbuzz/proto";

// Define a schema using veta validators
const User = object({ name: string(), age: number() });

// Compile a binary codec (once, since the codec is pre-compiled)
const codec = proto(User);

// Encode: no field names, no tags, just payload
const bytes = codec.encode({ name: "Alice", age: 30 });

// Decode
const user = codec.decode(bytes);
// => { name: "Alice", age: 30 }

// Exact encoded size, without encoding
const size = codec.size({ name: "Bob", age: 25 });
```

---

## API Reference

### `proto<T>(validator: (val: any, ctx?: any) => T): ProtoCodec<T>`

Compiles a binary codec from a veta schema validator. The validator must have `METADATA` attached (all veta validators do).

```ts
const codec = proto(object({ x: number(), y: number() }));
```

### `ProtoCodec<T>`

```ts
interface ProtoCodec<T> {
  encode(value: T): Uint8Array;
  decode(buffer: Uint8Array): T;
  size(value: T): number;
}
```

#### `encode(value: T): Uint8Array`

Encodes a value to compact binary. Returns a **copy** of the internal buffer.

```ts
const bytes = codec.encode({ x: 10, y: 20 });
```

#### `decode(buffer: Uint8Array): T`

Decodes binary data back to the typed value. Schema must match exactly.

The bytes must be one complete, well-formed value: a truncated buffer, bytes left over, a boolean byte other than `0x00`/`0x01`, a union index that does not exist, or an array count larger than the input could hold throws `ProtoDecodeError` (with the byte `offset`). `decode()` checks the **shape** of the bytes only. It does not run the validator, so `string({ max })`, `decimal({ scale })` or `refine()` rules are not checked: see [Decoding untrusted input](#decoding-untrusted-input).

```ts
const point = codec.decode(bytes);
// => { x: 10, y: 20 }
```

#### `size(value: T): number`

Calculates the encoded byte size **without encoding**. Exact match for `encode(value).length`. It allocates nothing for ASCII strings; a non-ASCII string is measured with `TextEncoder`.

```ts
codec.size({ x: 10, y: 20 }); // exact byte count
```

---

## Supported Types

| Type | Wire format | Overhead |
|---|---|---|
| `string` | `varint(len)` + UTF-8 | 1–5 bytes |
| `number` (int) | 1-byte flag + varint | 2–6 bytes |
| `number` (float) | 1-byte flag + 8 bytes float64 | 9 bytes |
| `boolean` | 1 byte (`0x00`/`0x01`) | 1 byte |
| `bigint` | 8 bytes int64 big-endian (−2^63 to 2^63−1) | 8 bytes |
| `date` | 8 bytes float64 (ms since epoch) | 8 bytes |
| `uint8array` | `varint(len)` + raw bytes | 1–5 bytes |
| `object` | Fields in key order, no overhead | 0 per field |
| `array` | `varint(len)` + items (items must take ≥ 1 byte) | 1–5 bytes |
| `tuple` | Items in order, no length prefix | 0 |
| `optional`/`nullable`/`nullish` | 1-byte flag + value | 1 byte |
| `union` | 1-byte variant index + value (at most 256 variants) | 1 byte |
| `literal` | 0 bytes | **0** |

### `object`

```ts
const User = object({
  id: string(),
  name: string(),
  age: number(),
  active: boolean(),
});
const codec = proto(User);
```

Wire format: Fields encoded **in schema key order**, with no field names, no tags, and no length prefix.

Objects can be arbitrarily nested:

```ts
const Response = object({
  status: string(),
  data: object({
    users: array(object({
      id: number(),
      name: string(),
    })),
    total: number(),
  }),
});
```

### `string`

```ts
const codec = proto(string());
```

Wire format: `varint(byteLength)` + UTF-8 bytes.

| Input | Encoded bytes |
|---|---|
| `""` | `0x00` |
| `"hello"` | `0x05` + `hello` |

ASCII strings under 128 bytes use a fast inline encoder (avoids `TextEncoder`).

### `number`

Wire format: 1-byte flag + data.

| Flag | Meaning | Data bytes | Range |
|---|---|---|---|
| `0x00` | Unsigned varint | 1–5 bytes | `0` to `4294967295` |
| `0x01` | Negative varint | 1–5 bytes | `-1` to `-2147483648` |
| `0x02` | Float64 | 8 bytes | Non-integer or out-of-range |

`-0` takes the integer path and decodes as `0`.

### `boolean`

1 byte (`0x00` for `false`, `0x01` for `true`).

### `bigint`

8 bytes, signed 64-bit big-endian. A value outside −2^63 … 2^63−1 throws a `RangeError` on encode (it used to be wrapped modulo 2^64, so `2n ** 64n + 5n` came back as `5n`).

### `date`

8 bytes, float64: milliseconds since epoch.

### `uint8array`

`varint(length)` + raw bytes.

### `array`

`varint(length)` + each element encoded consecutively.

```ts
const codec = proto(array(number()));
```

An array whose items encode to zero bytes (`array(literal("x"))`, or an array of objects made only of literals) is refused by `proto()`: its length could not be checked against the input on decode.

### `tuple`

Elements encoded in order, **no length prefix** (length is known from schema).

```ts
const codec = proto(tuple([string(), number(), boolean()]));
```

### `optional` / `nullable` / `nullish`

1-byte presence flag + value if present. All three write `0x00` for both `null` and `undefined`, so `nullish` decodes `null` as `undefined`.

```ts
// optional: 0x00 = undefined, 0x01 = value follows
// nullable: 0x00 = null, 0x01 = value follows
// nullish: 0x00 = undefined/null, 0x01 = value follows
```

### `union`

1-byte variant index + encoded value.

```ts
const codec = proto(union([string(), number(), boolean()]));

codec.encode("hello");  // variant index 0 + string
codec.encode(42);       // variant index 1 + number
```

Variants are tried in order and the first match wins, except for **object variants**: when a union has two or more, they are told apart by a field that is a `literal()` (or `picklist()`) with its own values in every variant, which is exactly what `discriminatedUnion()` requires. A union of objects with no such field is refused by `proto()`, because the encoder could not know which variant a value is. A union can contain `picklist()`, another `union`, or a `tuple`. `picklist()` is a union of literals, so it also holds at most 256 options.

### `literal`

**0 bytes**: the value is known from the schema.

```ts
const codec = proto(literal("ok"));
codec.encode("ok");   // => Uint8Array(0) (empty)
codec.decode(new Uint8Array(0)); // => "ok"
```

### Unsupported: `any`, `unknown`

These throw: the codec requires full type information for a deterministic wire format.

---

## Error Handling

| Scenario | Error |
|---|---|
| Validator lacks metadata | `"Validator has no schema metadata..."` |
| Schema uses `any` or `unknown` | `"Cannot create protobuf codec for '<type>'..."` |
| Union value matches no variant | `"Value does not match any union variant"` |
| Union of 2+ objects with no telling literal field | `"A union has N object variants and no literal field that tells them apart..."` (at `proto()`) |
| Union or picklist with more than 256 variants | `"A union (or picklist) has N variants..."` (at `proto()`) |
| Array of zero-byte items | `"Cannot create protobuf codec for an array whose items encode to zero bytes..."` (at `proto()`) |
| `bigint` outside int64 | `RangeError` (on encode) |
| Truncated, left-over or malformed bytes | `ProtoDecodeError` with `offset` |

---

## Common Patterns

### HTTP Binary Response

```ts
import { proto } from "@coderbuzz/proto";
import { object, number, string, array } from "@coderbuzz/veta";

const ApiResponse = object({
  status: number(),
  users: array(object({ id: number(), name: string() })),
});

const codec = proto(ApiResponse);

// Encode response directly to binary
app.get("/api/users", () => {
  const data = { status: 200, users: [{ id: 1, name: "Alice" }] };
  return new Response(codec.encode(data), {
    headers: { "Content-Type": "application/x-protobuf" },
  });
});

// Client: decode binary response
const res = await fetch("/api/users");
const buf = new Uint8Array(await res.arrayBuffer());
const result = codec.decode(buf);
// => { status: 200, users: [{ id: 1, name: "Alice" }] }
```

### WebSocket Frames with Pre-allocated Buffer

```ts
const Point = object({ x: number(), y: number() });
const codec = proto(Point);

const buf = new Uint8Array(codec.size({ x: 0, y: 0 })); // exact size of this value, not a worst case

ws.onmessage = (event) => {
  const point = codec.decode(new Uint8Array(event.data));
  // => { x: ..., y: ... }
};

function sendPoint(x: number, y: number) {
  const bytes = codec.encode({ x, y });
  ws.send(bytes);
}
```

### Discriminated Events

```ts
const ClickEvent = object({ type: literal("click"), x: number(), y: number() });
const KeyEvent = object({ type: literal("keyup"), key: string() });
const Event = discriminatedUnion("type", [ClickEvent, KeyEvent]); // union([...]) works too

const codec = proto(Event);
codec.encode({ type: "click" as const, x: 100, y: 200 });
// Wire: 0x00 (variant 0) + flag(0) + varint(100) + flag(0) + varint(200)
codec.encode({ type: "keyup" as const, key: "a" });
// Wire: 0x01 (variant 1) + varint(1) + "a"
```

The variant is chosen by `type`. In 0.1.32 and earlier the first object variant always won, so a `keyup` event came back as a `click`.

### Decoding untrusted input

`decode()` rejects bytes that are not a well-formed value, but it does not run the validator. For input from a client, decode and then validate:

```ts
import { proto, ProtoDecodeError } from "@coderbuzz/proto";
import { object, string, decimal, isVetaError } from "@coderbuzz/veta";
import { HttpError } from "@coderbuzz/velox";

const Invoice = object({ ref: string({ max: 32 }), amount: decimal({ scale: 2 }) });
const codec = proto(Invoice);

function read(bytes: Uint8Array) {
  try {
    return Invoice(codec.decode(bytes)); // shape checked by decode, rules by the validator
  } catch (err) {
    if (err instanceof ProtoDecodeError || isVetaError(err)) throw new HttpError(400, "Invalid body");
    throw err;
  }
}
```

### Schema Validation + Binary Encoding

```ts
// Validate first, then encode: coercion works at validation time
const schema = object({
  id: coerce(number()),
  name: string({ min: 2 }),
});

const codec = proto(schema);

function handle(raw: unknown): Uint8Array {
  const validated = schema(raw);     // validate + coerce
  return codec.encode(validated);    // encode from validated data
}

const bytes = handle({ id: "42", name: "Alice" });
// id is coerced "42" → 42 during validation, then 42 encoded as varint
```

### Bulk Encode with `size()`

```ts
function encodeBatch(items: User[]): Uint8Array {
  let total = 0;
  for (const item of items) total += codec.size(item);
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const item of items) {
    const bytes = codec.encode(item);
    buf.set(bytes, offset);
    offset += bytes.length;
  }
  return buf;
}
```

---

## Limitations

- **Schema must be known at both ends**: cannot decode without exact schema. Nothing in the bytes identifies the schema, so data encoded with a different version (fields reordered or added) is misread, not rejected. Do not store proto bytes past a schema change
- **Decode checks bytes, not rules**: run the validator on decoded untrusted input (see above)
- **No streaming**: entire message in memory
- **No CJS build**: ESM only
- **Requires `@coderbuzz/veta`**: schema validators from veta are the only way to define codecs
- **Every field must be described**: an `object` with a field whose validator has no `METADATA` (a custom function, `withContext()` without `meta`, `lazy()`, a `pipe()` ending in a custom function) has no metadata itself, and `proto()` throws. Describe the field with veta's `withMeta(fn, { type: ... })`. Before veta 0.5.0 such a field was silently left out of the wire format
- **Async validators compile** since veta 0.5.0: `objectAsync()`, `arrayAsync()` and the other async variants carry the same metadata as their sync counterparts

---

## License

MIT © 2026 Indra Gunawan
