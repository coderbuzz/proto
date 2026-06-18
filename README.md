<!-- docs: sync from coderbuzz/codex@76ca592 -->

# Proto — `@coderbuzz/proto`

Schema-driven binary serialization for TypeScript — Protobuf-style encoding
**without `.proto` files**.

`proto` compiles high-performance binary codecs from
[`@coderbuzz/kyo`](https://github.com/coderbuzz/kyo) schema validators at
runtime. Since the schema is known at both encode and decode time, the wire
format contains **no field names, no type tags, and no per-field headers** —
just pure payload data.

---

## How It Differs From Standard Protobuf

| Feature | Standard Protobuf | `@coderbuzz/proto` |
|---------|------------------|--------------------|
| Schema definition | `.proto` files + codegen | TypeScript validators (`@coderbuzz/kyo`) |
| Field encoding | Tag + wire type + value (varint prefixed) | Value only (no tags, no wire types) |
| Field order | Field number order | Schema key order (deterministic) |
| Codec timing | Build-time codegen | Runtime compilation from schema metadata |
| Unknown fields | Skipped during decode | Not applicable (schema required at both ends) |
| Union / `oneof` | Tag-based with explicit oneof wrapper | Variant index byte + value |

The wire format is significantly more compact than standard Protobuf for
structured data because **no metadata is transmitted per field**.

---

## Installation

```sh
# npm
npm install @coderbuzz/proto @coderbuzz/kyo

# Bun
bun add @coderbuzz/proto @coderbuzz/kyo

# Deno
import { object, string, number } from "npm:@coderbuzz/kyo";
import { proto } from "npm:@coderbuzz/proto";
```

---

## Quick Start

```ts
import { object, string, number } from "@coderbuzz/kyo";
import { proto } from "@coderbuzz/proto";

// Define a schema using kyo validators
const User = object({ name: string(), age: number() });

// Compile a binary codec
const codec = proto(User);

// Encode
const bytes = codec.encode({ name: "Alice", age: 30 });

// Decode
const user = codec.decode(bytes);
// => { name: "Alice", age: 30 }

// Pre-calculate size
const size = codec.size({ name: "Bob", age: 25 });
// => encoded byte count
```

---

## API Reference

### `proto<T>(validator: (val: any, ctx?: any) => T): ProtoCodec<T>`

Compiles a binary codec from a kyo schema validator. The validator must have
`METADATA` attached (all kyo validators do). Throws if the validator has no
metadata or uses `any`/`unknown` types.

```ts
const codec = proto(object({ x: number(), y: number() }));
```

### `ProtoCodec<T>`

Interface representing a compiled codec with three methods:

```ts
interface ProtoCodec<T> {
  encode(value: T): Uint8Array;
  decode(buffer: Uint8Array): T;
  size(value: T): number;
}
```

#### `encode(value: T): Uint8Array`

Encodes a value matching the schema to compact binary. Returns a **copy** of
the internal buffer.

```ts
const bytes = codec.encode({ x: 10, y: 20 });
```

#### `decode(buffer: Uint8Array): T`

Decodes binary data back to the typed value. The schema must match the encoding
schema exactly.

```ts
const point = codec.decode(bytes);
// => { x: 10, y: 20 }
```

#### `size(value: T): number`

Pre-calculates the encoded byte size **without allocating** any buffer. The
size always matches `encode(value).length`.

```ts
codec.size({ x: 10, y: 20 }); // => exact byte count
```

---

## Supported Types

### `string`

```ts
const codec = proto(string());
```

Wire format: `varint(byteLength)` + UTF-8 bytes.

Examples:
| Input | Encoded bytes |
|-------|---------------|
| `""` | `0x00` |
| `"hello"` | `0x05` + `hello` |
| Unicode | `varint(len)` + UTF-8 encoded |

ASCII strings under 128 bytes use a fast inline encoder (avoids `TextEncoder`).

---

### `number`

```ts
const codec = proto(number());
```

Wire format: `1-byte flag` + data.

| Flag | Meaning | Data bytes | Range |
|------|---------|------------|-------|
| `0x00` | Unsigned varint | 1–5 bytes | `0` to `4294967295` |
| `0x01` | Negative varint | 1–5 bytes | `-1` to `-2147483648` |
| `0x02` | Float64 | 8 bytes | Non-integer or out-of-range |

**Integer path** (flags `0`/`1`): Used when `val` is an integer within
`[-2147483648, 4294967295]`. Signed integer range is encoded via absolute value
with sign flag.

**Float path** (flag `2`): Used for non-integral values and integers outside
the safe varint range (including `Number.MAX_SAFE_INTEGER`).

```ts
const NumCodec = proto(number());

// Varint path (unsigned):
NumCodec.encode(42);     // flag 0x00 + varint(0x2a)
// Varint path (negative):
NumCodec.encode(-99);    // flag 0x01 + varint(0x63)
// Float64 path:
NumCodec.encode(3.14);   // flag 0x02 + 8 bytes float64
```

---

### `boolean`

```ts
const codec = proto(boolean());
```

Wire format: 1 byte (`0x00` for `false`, `0x01` for `true`).

---

### `bigint`

```ts
const codec = proto(bigint());
```

Wire format: 8 bytes, signed 64-bit big-endian (`DataView.setBigInt64`).

---

### `date`

```ts
const codec = proto(date());
```

Wire format: 8 bytes, float64 — milliseconds since epoch
(`Date.prototype.getTime()`).

---

### `uint8array`

```ts
const codec = proto(uint8array());
```

Wire format: `varint(length)` + raw bytes.

---

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

Wire format: Fields encoded **in schema key order** — no field names, no tags,
no length prefix. The schema determines the exact byte layout.

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

---

### `array`

```ts
const codec = proto(array(number()));
```

Wire format: `varint(length)` + each element encoded consecutively.

Element types can be any valid kyo schema (including nested objects).

---

### `tuple`

```ts
const codec = proto(tuple([string(), number(), boolean()]));
```

Wire format: Elements encoded in order — **no length prefix** (length is known
from schema).

---

### `optional`

```ts
const codec = proto(optional(string()));
```

Wire format: 1-byte presence flag + value if present.
- `0x00` → value is `undefined`
- `0x01` → value follows

```ts
const value: string | undefined = "hello";
const bytes = codec.encode(value);
// => [0x01, varint(5), ..."hello"]
```

---

### `nullable`

```ts
const codec = proto(nullable(string()));
```

Wire format: 1-byte presence flag + value if present.
- `0x00` → value is `null`
- `0x01` → value follows

---

### `nullish`

```ts
const codec = proto(nullish(string()));
```

Wire format: 1-byte presence flag + value if present.
- `0x00` → value is `undefined`
- `0x01` → value follows

**Note:** `null` is coerced to `undefined` on decode.

---

### `union`

```ts
const codec = proto(union([string(), number(), boolean()]));
```

Wire format: 1-byte variant index + encoded value.

Each variant is matched at runtime against the input value using `typeof`,
`instanceof`, or exact equality (for literals). The variant index (`0`, `1`,
`2`, ...) is written as a single byte prefix.

```ts
const data: string | number | boolean = "hello";
const bytes = codec.encode("hello");  // variant index 0 + string
const val = codec.decode(bytes);       // => "hello"
```

**Throws at runtime** if no variant matches the value:
`"Value does not match any union variant"`

---

### `literal`

```ts
const codec = proto(literal("ok"));
```

Wire format: **0 bytes**. The value is known from the schema and requires no
wire representation.

```ts
codec.encode("ok");   // => Uint8Array(0) (empty)
codec.decode(new Uint8Array(0)); // => "ok"
```

---

### Unsupported Types

`any` and `unknown` are **not supported** — the codec requires full type
information to produce a deterministic wire format. Using them throws:

```
Cannot create protobuf codec for '<type>' — schema must be fully specified
```

---

## Wire Format Summary

| Type | Bytes | Formula |
|------|-------|---------|
| `string` | 1–5 + N | `varint(len) + UTF-8` |
| `number` (int) | 2–6 | `flag(1) + varint(abs)` |
| `number` (float) | 9 | `flag(1) + float64(8)` |
| `boolean` | 1 | `0x00` or `0x01` |
| `bigint` | 8 | int64 big-endian |
| `date` | 8 | float64 ms since epoch |
| `uint8array` | 1–5 + N | `varint(len) + bytes` |
| `object` | sum(fields) | fields in key order, no overhead |
| `array` | 1–5 + sum(items) | `varint(len) + items` |
| `tuple` | sum(items) | items in order, no length prefix |
| `optional`/`nullable`/`nullish` | 1 + inner | presence flag + value |
| `union` | 1 + variant | variant index byte + value |
| `literal` | 0 | zero bytes |

---

## Performance

`proto` is designed for applications where wire size and encoding speed matter:

- **Smaller than JSON** for structured data — the test suite verifies medium
  objects are < 70% of JSON size.
- **Smaller than MessagePack** for structured data — no per-value type tags.
- **Pre-calculable size** — `size()` lets you pre-allocate buffers, avoiding
  double-buffering in high-throughput scenarios.
- **Compiled codecs** — the encoder/decoder/sizer functions are compiled from
  the schema metadata once at `proto()` call time, not at each encode/decode.
- **ASCII fast path** — short ASCII strings bypass `TextEncoder`/`TextDecoder`.

---

## Error Handling

| Scenario | Error |
|----------|-------|
| Validator lacks metadata | `"Validator has no schema metadata. Use Ken schema validators..."` |
| Schema uses `any` or `unknown` | `"Cannot create protobuf codec for '<type>' — schema must be fully specified"` |
| Union value matches no variant | `"Value does not match any union variant"` |
| Malformed binary during decode | Unpredictable (no bounds checking) |

---

## Limitations

- **Schema must be known at both ends** — Unlike standard Protobuf, the wire
  format cannot be decoded without the exact schema.
- **No bounds checking on decode** — Only decode trusted data.
- **No streaming** — The entire message must be in memory.
- **No CJS build** — ESM only.
- **Requires `@coderbuzz/kyo`** — Schema validators from kyo are the only way
  to define codecs.

---

## License

MIT &copy; 2026 Indra Gunawan
