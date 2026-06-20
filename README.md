<!-- docs: sync from coderbuzz/codex@796aac1 -->

# Proto — `@coderbuzz/proto`

> **Binary serialization for TypeScript. Smaller than Protobuf. No `.proto` files. Zero per-field overhead.**
> AI agents: see [AI_KNOWLEDGE.md](https://github.com/coderbuzz/proto/blob/main/AI_KNOWLEDGE.md) for expert context.

Proto compiles high-performance binary codecs from `@coderbuzz/veta` schema validators at **runtime**. Since the schema is known at both ends, the wire format contains **no field names, no type tags, and no per-field headers** — just pure payload data.

The result: **structured data smaller than Protobuf, smaller than MessagePack, and dramatically smaller than JSON** — with full TypeScript type safety.

---

## Why Proto Over Standard Protobuf, MessagePack, or BSON?

| Pain Point | Standard Protobuf | MessagePack | BSON | **@coderbuzz/proto** |
|---|---|---|---|---|
| Schema definition | `.proto` files + codegen | None (self-describing) | None (self-describing) | **TypeScript validators** (`@coderbuzz/veta`) — no build step |
| Per-field overhead | Tag + wire type + value | Type tag per value | Type tag + field name | **Zero** — no metadata per field |
| Wire format size | Medium (tags add bytes) | Large (type tags) | Large (field names) | **Smallest** — pure payload |
| Schema evolution | Designed for | N/A | N/A | Not supported (both ends must match) |
| Runtime compilation | Build-time codegen | Runtime | Runtime | **Runtime** — compile from schema metadata once |
| Union / `oneof` | Tag-based | No | No | **1 byte variant index** + value |
| TypeScript integration | External `.d.ts` | Manual | Manual | **Native** — types from veta validators |
| Pre-calculate size | Manual | No | No | **`size()`** — exact bytes without encoding |

---

## How It Differs From Standard Protobuf

| Feature | Standard Protobuf | `@coderbuzz/proto` |
|---|---|---|
| Schema definition | `.proto` files + codegen | TypeScript validators (`@coderbuzz/veta`) |
| Field encoding | Tag + wire type + value (varint prefixed) | Value only — no tags, no wire types |
| Field order | Field number order | Schema key order (deterministic) |
| Codec timing | Build-time codegen | Runtime compilation from schema metadata |
| Unknown fields | Skipped during decode | Not applicable (schema required at both ends) |
| Union / `oneof` | Tag-based with explicit oneof wrapper | 1-byte variant index + value |
| `literal` encoding | Encoded as field value | **0 bytes** — value known from schema |

---

## Benchmarks

Full results at **[github.com/coderbuzz/benchmarks](https://github.com/coderbuzz/benchmarks)**.

All tests on Apple M-series, Bun runtime.

### Wire Size (nested object)

| Format | Bytes | vs JSON |
|---|---|---|
| **@coderbuzz/proto** | **65** | **53% smaller** |
| @coderbuzz/msgpack | 111 | 20% smaller |
| JSON | 139 | — |

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

// Compile a binary codec (once — the codec is pre-compiled)
const codec = proto(User);

// Encode — no field names, no tags, just payload
const bytes = codec.encode({ name: "Alice", age: 30 });

// Decode
const user = codec.decode(bytes);
// => { name: "Alice", age: 30 }

// Pre-calculate size without allocating
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

```ts
const point = codec.decode(bytes);
// => { x: 10, y: 20 }
```

#### `size(value: T): number`

Pre-calculates encoded byte size **without allocating** any buffer. Exact match for `encode(value).length`.

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
| `bigint` | 8 bytes int64 big-endian | 8 bytes |
| `date` | 8 bytes float64 (ms since epoch) | 8 bytes |
| `uint8array` | `varint(len)` + raw bytes | 1–5 bytes |
| `object` | Fields in key order, no overhead | 0 per field |
| `array` | `varint(len)` + items | 1–5 bytes |
| `tuple` | Items in order, no length prefix | 0 |
| `optional`/`nullable`/`nullish` | 1-byte flag + value | 1 byte |
| `union` | 1-byte variant index + value | 1 byte |
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

Wire format: Fields encoded **in schema key order** — no field names, no tags, no length prefix.

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

### `boolean`

1 byte (`0x00` for `false`, `0x01` for `true`).

### `bigint`

8 bytes, signed 64-bit big-endian.

### `date`

8 bytes, float64 — milliseconds since epoch.

### `uint8array`

`varint(length)` + raw bytes.

### `array`

`varint(length)` + each element encoded consecutively.

```ts
const codec = proto(array(number()));
```

### `tuple`

Elements encoded in order — **no length prefix** (length is known from schema).

```ts
const codec = proto(tuple([string(), number(), boolean()]));
```

### `optional` / `nullable` / `nullish`

1-byte presence flag + value if present.

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

### `literal`

**0 bytes** — the value is known from the schema.

```ts
const codec = proto(literal("ok"));
codec.encode("ok");   // => Uint8Array(0) (empty)
codec.decode(new Uint8Array(0)); // => "ok"
```

### Unsupported: `any`, `unknown`

These throw — the codec requires full type information for a deterministic wire format.

---

## Error Handling

| Scenario | Error |
|---|---|
| Validator lacks metadata | `"Validator has no schema metadata..."` |
| Schema uses `any` or `unknown` | `"Cannot create protobuf codec for '<type>' — schema must be fully specified"` |
| Union value matches no variant | `"Value does not match any union variant"` |
| Malformed binary | Unpredictable (no bounds checking) |

---

## Limitations

- **Schema must be known at both ends** — cannot decode without exact schema
- **No bounds checking on decode** — only decode trusted data
- **No streaming** — entire message in memory
- **No CJS build** — ESM only
- **Requires `@coderbuzz/veta`** — schema validators from veta are the only way to define codecs

---

## License

MIT © 2026 Indra Gunawan
