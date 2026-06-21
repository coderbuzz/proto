<!-- docs: sync from coderbuzz/codex@e5210d1 -->

# Proto — AI Agent Knowledge File

**Package:** `@coderbuzz/proto`
**Purpose:** Schema-driven binary serialization — Protobuf-style encoding
without `.proto` files.\
**Distribution:** ESM only (`dist/index.js` + `dist/index.d.ts`). No source
`.ts` files in the package.\
**Dependency:** Requires `@coderbuzz/veta` for schema validators.

---

## Mental Model

`proto` compiles **three optimized closure functions** from a veta schema
`TypeMeta` tree at `proto()` call time:
1. **Encoder** — writes binary to a reusable internal buffer
2. **Decoder** — reads binary from an input buffer
3. **Sizer** — calculates byte size without allocating

These closures are compiled once and cached in the returned `ProtoCodec`
object. There is no runtime schema lookup during encode/decode.

```
schema (veta validator)
  │
  ├─ validator[METADATA] → TypeMeta tree
  │
  ├─ compileEncoder(meta) → (val) => void
  ├─ compileDecoder(meta) → () => any
  └─ compileSizer(meta)   → (val) => number
       │
       ▼
  { encode, decode, size }
```

---

## Import Map

```ts
import { proto } from "@coderbuzz/proto";

// Also import veta validators
import { object, string, number, boolean, array, union, literal, optional, nullable, nullish, tuple, date, bigint, uint8array } from "@coderbuzz/veta";
```

---

## `proto<T>(validator): ProtoCodec<T>`

The single entry point. Takes a veta validator function and returns a compiled
codec.

```ts
const codec = proto(object({ name: string(), age: number() }));
```

**Rules:**
- `validator` MUST be a veta validator (has `validator[METADATA]`).
- Plain validator functions (e.g., `(val) => val`) throw:
  `"Validator has no schema metadata. Use Ken schema validators..."`.
- `any` and `unknown` are NOT supported — throws:
  `"Cannot create protobuf codec for '<type>' — schema must be fully specified"`.
- All other veta types (`string`, `number`, `boolean`, `bigint`, `date`,
  `uint8array`, `object`, `array`, `tuple`, `optional`, `nullable`, `nullish`,
  `union`, `literal`) are supported.

---

### `ProtoCodec<T>` Interface

```ts
interface ProtoCodec<T> {
  encode(value: T): Uint8Array;
  decode(buffer: Uint8Array): T;
  size(value: T): number;
}
```

## Encoding Rules

### Internal Buffer

- Single module-level reusable buffer (`buf`, `dv`, `pos`).
- Starts at 64 KB, grows geometrically (doubles) when needed.
- Each `encode()` call resets `pos = 0` and uses the shared buffer.
- Thread-safe because JS is single-threaded and encode is synchronous.

### Varint Encoding

Unsigned variable-length integer (MSB continuation bit):

| Value Range | Bytes |
|-------------|-------|
| `0..127` | 1 |
| `128..16383` | 2 |
| `16384..2097151` | 3 |
| `2097152..268435455` | 4 |
| `268435456..4294967295` | 5 |

`varintSize(val)` pre-computes the byte count without writing.

---

## Type-Specific Rules

### `string`

```ts
const codec = proto(string());
```

| Byte length | Header |
|-------------|--------|
| `varint(len)` | 1–5 bytes |

**ASCII fast path:** If `val.length < 128` and all chars are `<= 0x7F`, the
encoder writes each byte inline (avoids `TextEncoder`). The decoder also uses
a fast ASCII path when `byteLen < 64` and all bytes are `<= 0x7F`.

---

### `number`

Three-way dispatch based on value at encode time:

```ts
const codec = proto(number());
codec.encode(42);      // flag 0x00 + varint(42)       — unsigned varint
codec.encode(-99);     // flag 0x01 + varint(99)       — negative varint
codec.encode(3.14);    // flag 0x02 + float64(3.14)    — float64
codec.encode(1e20);    // flag 0x02 + float64           — exceeds varint range
```

**Integer range for varint path:** `[-2147483648, 4294967295]`.

**Rules:**
- Integers outside varint range use float64.
- Non-integer values (including `Infinity`, `-Infinity`, `NaN`) use float64.

---

### `boolean`

1 byte: `0x00` for `false`, `0x01` for `true`.

---

### `bigint`

8 bytes — signed 64-bit big-endian (`DataView.setBigInt64`).

---

### `date`

8 bytes — float64 of `.getTime()` (milliseconds since epoch).

---

### `uint8array`

`varint(length)` + raw bytes.

---

### `object`

Fields encoded **in schema key order** — no field names, no tags, no length
prefix. The schema is the sole determinant of the wire layout.

```ts
const Point = object({ x: number(), y: number() });
const codec = proto(Point);

// Wire format:
//   flag(0) + varint(x) + flag(0) + varint(y)    (for small positive coords)
// No field names, no separators
```

Objects can be nested arbitrarily deep. Each nested object is encoded inline
(no headers).

---

### `array`

`varint(length)` + each element encoded consecutively.

```ts
const codec = proto(array(number()));
// [42, 99, 3.14] encodes as:
//   varint(3) + flag(0) + varint(42) + flag(0) + varint(99) + flag(2) + float64(3.14)
```

---

### `tuple`

Elements encoded in order — **no length prefix**. Length is determined by the
schema.

```ts
const codec = proto(tuple([string(), number(), boolean()]));
// ["hello", 42, true] encodes as:
//   varint(5) + "hello" + flag(0) + varint(42) + 0x01
```

---

### `optional`

```ts
const codec = proto(optional(number()));
// Codec type: number | undefined
```

Wire: 1-byte presence flag + value if present.
- `0x00` → value is `undefined`
- `0x01` → value follows

---

### `nullable`

```ts
const codec = proto(nullable(number()));
// Codec type: number | null
```

Wire: 1-byte presence flag + value if present.
- `0x00` → value is `null`
- `0x01` → value follows

---

### `nullish`

```ts
const codec = proto(nullish(number()));
// Codec type: number | null | undefined — but null is coerced to undefined
```

Wire: 1-byte presence flag + value if present.
- `0x00` → value is `undefined`
- `0x01` → value follows

**Lossy behavior:** `null` is encoded as `0x00`, decoded as `undefined`.

---

### `union`

```ts
const codec = proto(union([string(), number(), boolean()]));
```

Wire: 1-byte variant index + encoded value.

**Variant matching** (at encode time):

| Type | Match condition |
|------|----------------|
| `string` | `typeof val === 'string'` |
| `number` | `typeof val === 'number'` |
| `boolean` | `typeof val === 'boolean'` |
| `bigint` | `typeof val === 'bigint'` |
| `date` | `val instanceof Date` |
| `uint8array` | `val instanceof Uint8Array` |
| `object` | `typeof val === 'object' && val !== null && !Array.isArray(val)` |
| `array` | `Array.isArray(val)` |
| `literal` | `val === meta.value` |
| `optional/nullable/nullish` | `val === undefined \|\| val === null \|\| matchesMeta(val, meta.inner)` |

**Order matters:** The first matching variant wins. Declare more specific types
(e.g., `literal`) before general types (e.g., `string`).

**Throws at runtime** if no variant matches:
`"Value does not match any union variant"`

---

### `literal`

```ts
const codec = proto(literal("ok"));
```

Wire: **0 bytes**. The value is embedded in the compiled codec.

```ts
codec.encode("ok");         // => Uint8Array(0)
codec.decode(emptyBuffer);  // => "ok"
```

---

## Common Patterns

### Basic Object

```ts
import { object, string, number, boolean } from "@coderbuzz/veta";
import { proto } from "@coderbuzz/proto";

const User = object({
  id: string(),
  name: string(),
  age: number(),
  active: boolean(),
});

const userCodec = proto(User);

// Encode
const bytes = userCodec.encode({
  id: "usr_001",
  name: "Alice",
  age: 30,
  active: true,
});

// Decode
const user = userCodec.decode(bytes);
// => { id: "usr_001", name: "Alice", age: 30, active: true }
```

### Nested Objects

```ts
const Address = object({
  street: string(),
  city: string(),
  zip: string(),
});

const Person = object({
  name: string(),
  address: Address,            // nested
  tags: array(string()),      // array of strings
});

const codec = proto(Person);
```

### Optional Fields

```ts
const Config = object({
  host: string(),
  port: number(),
  token: optional(string()),   // string | undefined
  timeout: optional(number()), // number | undefined
});

const codec = proto(Config);

// Both encode and decode work with or without the optional fields
codec.encode({ host: "localhost", port: 8080 });
codec.encode({ host: "localhost", port: 8080, token: "abc" });
```

### Union Types

```ts
const Value = union([
  literal("none"),
  number(),
  string(),
]);

const codec = proto(Value);

codec.encode("none");      // variant 0, 0 bytes payload
codec.encode(42);          // variant 1
codec.encode("hello");     // variant 2
```

### Bulk Pre-Allocation

```ts
const codec = proto(Point);

function encodeBatch(points: Point[]): Uint8Array {
  const sizes = points.map((p) => codec.size(p));
  const total = sizes.reduce((a, b) => a + b, 0);
  
  // Use internal encode, then copy — or use a pooled approach
  const buf = new Uint8Array(total);
  const scratch = new Uint8Array(9); // max varint + flag
  let offset = 0;
  for (const point of points) {
    const bytes = codec.encode(point);
    buf.set(bytes, offset);
    offset += bytes.length;
  }
  return buf;
}
```

### Real-World Schema

```ts
const User = object({
  id: number(),
  name: string(),
  email: string(),
  active: boolean(),
  score: number(),
  tags: array(string()),
  address: optional(object({
    street: string(),
    city: string(),
    zip: string(),
  })),
});

const codec = proto(User);

// Round-trip
const user = {
  id: 1,
  name: "Alice",
  email: "alice@example.com",
  active: true,
  score: 95.5,
  tags: ["admin", "premium"],
  address: {
    street: "123 Main St",
    city: "Metropolis",
    zip: "10001",
  },
};

const bytes = codec.encode(user);
const decoded = codec.decode(bytes);
// decoded is structurally identical to `user` (verified via .toEqual())
```

---

## Size Estimation

`codec.size(val)` computes the exact byte count. Use for:
- Pre-allocating response buffers
- Content-Length headers in streaming protocols
- Estimating payload costs (e.g., bandwidth metering)

```ts
const payload = { id: 1, name: "Alice", scores: [95, 87, 92] };
const byteCount = codec.size(payload);
// byteCount === codec.encode(payload).length  (always true)
```

---

## Error Handling

```ts
try {
  const bytes = codec.encode(value);
  const decoded = codec.decode(bytes);
} catch (err) {
  // May be:
  //   Error("Validator has no schema metadata...")
  //   Error("Cannot create protobuf codec for '<type>'...")
  //   Error("Value does not match any union variant")
  //   RangeError (DataView reading past buffer — malformed input)
}
```

---

## Wire Size Comparison

`proto` is optimized for minimal wire size:

| Payload | JSON | MessagePack | proto |
|---------|------|-------------|-------|
| `{id:1, name:"Ken", active:true}` | ~38 B | ~30 B | ~17 B |
| 3-user array with nested objects | ~240 B | ~180 B | ~120 B |

The savings come from:
1. **No field names** — unlike JSON/MessagePack
2. **No per-value type tags** — unlike MessagePack
3. **Efficient integer encoding** — varint for common ranges
