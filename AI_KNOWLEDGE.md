<!-- docs: sync from coderbuzz/codex@a7c7bb5 -->

# Proto: AI Agent Knowledge File

**Package:** `@coderbuzz/proto`
**Purpose:** Schema-driven binary serialization (Protobuf-style encoding
without `.proto` files).\
**Distribution:** ESM only (`dist/index.js` + `dist/index.d.ts`). No source
`.ts` files in the package.\
**Dependency:** Requires `@coderbuzz/veta` for schema validators.

---

## Mental Model

`proto` compiles **three optimized closure functions** from a veta schema
`TypeMeta` tree at `proto()` call time:
1. **Encoder**: writes binary to a reusable internal buffer
2. **Decoder**: reads binary from an input buffer
3. **Sizer**: calculates byte size without allocating

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
import { proto, ProtoDecodeError, ProtoEncodeError, type ProtoCodec, type ProtoOptions, type DecodeOptions } from "@coderbuzz/proto";

// Also import veta validators
import { object, string, number, boolean, array, union, literal, optional, nullable, nullish, tuple, date, bigint, uint8array, picklist, discriminatedUnion, decimal, isoDate, record } from "@coderbuzz/veta";
```

---

## `proto<T>(validator, options?): ProtoCodec<Awaited<T>>`

The single entry point. Takes a veta validator function and returns a compiled
codec.

```ts
function proto<T>(
  validator: (val: any, ctx?: any) => T,
  options?: ProtoOptions,          // { header?: boolean } — default false
): ProtoCodec<Awaited<T>>;

const codec = proto(object({ name: string(), age: number() }));
const stored = proto(Invoice, { header: true }); // 5-byte header with the schema fingerprint
```

**Rules:**
- `validator` MUST be a veta validator (has `validator[METADATA]`).
- Plain validator functions (e.g., `(val) => val`) throw:
  `"Validator has no schema metadata, so no codec can be built for it..."`.
  Describe one with veta's `withMeta(fn, { type: ... })`.
- `any` and `unknown` are NOT supported, and throws:
  `"Cannot create protobuf codec for '<type>'..."` ("schema must be fully specified").
- All other veta types (`string`, `number`, `boolean`, `bigint`, `date`,
  `uint8array`, `object`, `array`, `tuple`, `optional`, `nullable`, `nullish`,
  `union`, `literal`, `record`) are supported. `decimal()` and `isoDate()` carry `string`
  metadata and encode as strings, exactly (`'10.10'` stays `'10.10'`).
  `picklist()` and `discriminatedUnion()` carry union metadata: a picklist holds
  at most 256 options, and a discriminatedUnion is encoded by its tag field.
- `proto()` also throws, at compile time, for: a union (or picklist) with more
  than 256 variants; a union with 2+ object variants and no literal/picklist
  field whose values tell them apart; an array whose items encode to zero bytes
  (`array(literal("x"))`, an array of all-literal objects). `lazy()` has no
  metadata (a recursive type has no finite `TypeMeta`), so it throws the "no
  schema metadata" error. `record()` has `{ type: 'record', key, value }`
  metadata when both its key and value validators are described (veta, same
  release as this proto).
- Since veta 0.5.0 the async variants carry the same metadata as the sync ones,
  so `proto(objectAsync(...))` compiles (the codec never calls the validator).
  Its type is `ProtoCodec<Awaited<T>>`: the value the promise resolves to, which is
  what `decode()` returns at runtime (in 0.1.32 and earlier it was typed as a `Promise`).
  `withContext()` has metadata only when given `{ meta }`; `lazy()` never.

---

### `ProtoCodec<T>` Interface

```ts
interface ProtoCodec<T> {
  encode(value: T): Uint8Array;                            // throws ProtoEncodeError on a wrongly typed value
  decode(buffer: Uint8Array, options?: DecodeOptions): T;  // throws ProtoDecodeError on malformed bytes
  size(value: T): number;                                  // exact bytes; no allocation, no type checks
  readonly fingerprint: number;                            // uint32 hash of the wire layout
}

interface ProtoOptions {
  header?: boolean;   // default false: prefix encodings with version 1 + fingerprint (5 bytes)
}

interface DecodeOptions {
  validate?: boolean; // default false: run the validator on the decoded value and return its output
}

class ProtoDecodeError extends Error {
  readonly name: 'ProtoDecodeError';
  readonly offset: number;          // byte position where decoding stopped
  // message: "<reason> at byte <offset>"
}

class ProtoEncodeError extends TypeError {
  readonly name: 'ProtoEncodeError';
  readonly path: (string | number)[]; // ['lines', 2, 'qty']; [] at the root
  readonly reason: string;            // the message without the path
  // message: "<reason> at <path joined by '.'>", or just "<reason>" at the root
}
```

## Encode type checks (after 0.2.0)

Every encoder checks its value before writing it, because the wire format has
no type tags: a wrong type used to be written as something else and decoded
without complaint.

| Schema | Accepts | Otherwise (`ProtoEncodeError` reason) |
|---|---|---|
| `string` (incl. `decimal`, `isoDate`) | `typeof === 'string'` | `Expected string, got number` |
| `number` | `typeof === 'number'` (NaN, ±Infinity included) | `Expected number, got undefined` |
| `boolean` | `typeof === 'boolean'` | `Expected boolean, got undefined` |
| `bigint` | `typeof === 'bigint'`, within int64 (else `RangeError`) | `Expected bigint, got number` |
| `date` | `instanceof Date` (an invalid Date encodes as NaN) | `Expected Date, got string` |
| `uint8array` | `instanceof Uint8Array` (a Node `Buffer` too) | `Expected Uint8Array, got array` |
| `object`, `record` | non-null, non-array object | `Expected object, got null` |
| `array` | `Array.isArray` | `Expected array, got string` |
| `tuple` | array of exactly the tuple's length | `Expected a tuple of 2, got 1 item(s)` |
| `literal` | `=== value` | `Expected "invoice", got "credit_note"` |
| `optional` | `undefined` or a value (`null` refused) | `Expected a value or undefined, got null` |
| `nullable` | `null` or a value (`undefined` refused) | `Expected a value or null, got undefined` |
| `nullish` | `null`, `undefined` or a value | n/a |
| `union` | a value some variant accepts | `Value does not match any union variant` |

The path is collected on the way out of objects (key), arrays and tuples
(index) and records (key), and appended to the message at the top: `Expected
number, got string at lines.2.qty`. Cost: about 2% on a 20-line invoice encode
(Bun 1.4.2), within the 5% budget set for it. `size()` does not type-check.

## Schema fingerprint and `{ header: true }` (after 0.2.0)

`codec.fingerprint` is FNV-1a (32-bit) over a canonical text of the `TypeMeta`,
computed once in `proto()`:

```
object   → {"key":<layout>,...}   (keys in shape order, names included)
record   → record(<key>,<value>)
array    → array(<items>)          tuple → tuple(<a>,<b>)
optional/nullable/nullish → <type>(<inner>)
union    → union(<a>|<b>|...)
literal  → literal(<typeof>:<JSON>) (so 1 and "1" differ)
others   → the type name ("string", "number", ...)
```

It hashes UTF-16 code units, so it is identical in Bun, Node, Deno and
browsers. It changes when a field is renamed, reordered, added, removed or
retyped, when a union gains or loses a variant, and when a literal changes. It
does not change for rules that do not touch the bytes (`string({ max })`,
`decimal({ scale })`, `refine()`).

With `{ header: true }`, `encode()` writes `0x01` + `fingerprint` (uint32
big-endian) before the value, `size()` adds 5, and `decode()` checks both:
`Unknown header version 2 at byte 0`, or `Schema fingerprint mismatch: the bytes
were written by schema 1a2b3c4d, this codec is 5e6f7a8b at byte 1`. Headerless
bytes fed to a header codec fail the same way. The option does not make old
bytes readable by a new schema; it makes the mismatch an error instead of
silently swapped fields.

Use cases: bytes that outlive a process (a `kvs` cache, a job queue across a
rolling deploy): either `{ header: true }`, or `codec.fingerprint` in the key.

## Decode checks (after 0.1.32)

`decode()` refuses, with `ProtoDecodeError`, every byte sequence that is not
exactly one value of the schema:

| Check | Example message |
|---|---|
| Input ends before the value does (any fixed-width read, string/bytes length, varint) | `Unexpected end of input: 6 more byte(s) needed at byte 7` |
| Bytes left after the value | `4 trailing byte(s) after the value at byte 14` |
| Boolean or presence byte not `0x00`/`0x01` | `Invalid boolean byte 0x07 at byte 0` |
| Number flag not `0`/`1`/`2` | `Invalid number flag 0x03 at byte 0` |
| Union index ≥ variant count | `Union variant 9 does not exist (2 variants) at byte 0` |
| Varint longer than 5 bytes or above 2^32−1 | `Varint does not fit in 32 bits at byte 4` |
| Array count larger than the remaining bytes can hold (count > remaining / minimum item size) | `Array count 4294967295 is more than the 0 byte(s) left can hold at byte 0` |

The array check runs before anything is allocated. In 0.1.32 and earlier, a 5-byte
payload (`ff ff ff ff 0f`) made `decode()` allocate a 4,294,967,295-element
array and the process ran out of memory; a truncated buffer decoded to
plausible garbage (`"100.\u0000\u0000"`, `false`).

What `decode()` does **not** check by default: the validator's rules
(`string({ max })`, `decimal({ scale })`, `number({ integer, min })`, `isoDate()`
format, `refine()`, `check()`; picklist values are safe because they are
indices). For untrusted input pass `{ validate: true }`: the validator runs on
the decoded value and **its output** is returned (a `decimal` comes back
normalized), or its `VetaError` is thrown. Rules:

- The validator must be synchronous. If it returns a Promise (`objectAsync`),
  `decode()` throws `TypeError("decode(bytes, { validate: true }) needs a
  synchronous validator...")` and the Promise's rejection is swallowed; await
  `Schema(codec.decode(bytes))` yourself.
- The validator must accept its own output. `object().map({...})` reads source
  keys that its output does not have, so it fails; so does a `pipe()` whose
  transform is not idempotent.
- It runs after the byte checks, so a `ProtoDecodeError` comes first.

Cost measured on a 20-line invoice (Bun 1.4.2): decode 12 µs, decode + validate
31.6 µs; the bounds checks themselves cost 2–9%.

## Encoding Rules

### Internal Buffer

- Single module-level reusable buffer (`buf`, `dv`, `pos`).
- Starts at 64 KB, grows geometrically (doubles, by multiplication; the old
  `<<=` wrapped at 2^31 and looped forever above 1 GiB) when needed.
- Each `encode()` call resets `pos = 0` and uses the shared buffer.
- After an encode that grew it past 1 MiB, the buffer is replaced by a fresh
  64 KB one (after 0.2.0), so one large export does not pin hundreds of MB for
  the life of the process (measured: 268.5 MB of ArrayBuffer memory retained
  after a 200 MB encode before, 0.2 MB after).
- Re-entrant: an `encode()` called while another is running (a getter on the
  value that encodes something else) gets its own buffer, and the outer state
  is restored afterwards. In 0.1.32 and earlier, the inner call overwrote the outer
  bytes. An encode that throws leaves the codec usable.

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
codec.encode(42);      // flag 0x00 + varint(42): unsigned varint
codec.encode(-99);     // flag 0x01 + varint(99): negative varint
codec.encode(3.14);    // flag 0x02 + float64(3.14): float64
codec.encode(1e20);    // flag 0x02 + float64: exceeds varint range
```

**Integer range for varint path:** `[-2147483648, 4294967295]`.

**Rules:**
- Integers outside varint range use float64.
- Non-integer values (including `Infinity`, `-Infinity`, `NaN`) use float64.
- `-0` passes `Number.isInteger`, takes the unsigned varint path, and decodes as `0`.

---

### `boolean`

1 byte: `0x00` for `false`, `0x01` for `true`.

---

### `bigint`

8 bytes: signed 64-bit big-endian (`DataView.setBigInt64`).
Range −2^63 … 2^63−1; outside it `encode()` throws
`RangeError: bigint <n> does not fit in the 64-bit signed wire format`
(`setBigInt64` would silently take the value modulo 2^64). veta's `bigint()`
accepts any size, so check the range in the schema if values can be larger.

---

### `date`

8 bytes: float64 of `.getTime()` (milliseconds since epoch).

---

### `uint8array`

`varint(length)` + raw bytes.

---

### `object`

Fields encoded **in schema key order**, with no field names, no tags, and no length
prefix. The schema is the sole determinant of the wire layout.

**Gotchas:**
- An object with a field whose validator has no `METADATA` (custom function,
  `withContext()` without `meta`, `lazy()`, `pipe()` ending in a custom function)
  has no metadata itself (veta 0.5.0, `VETA-26`), so `proto()` throws. Before,
  veta described only the other fields and proto silently dropped that one from
  the wire. Fix with `withMeta()`.
- Keys in the value that are not in the schema are ignored (including keys kept
  by `unknownKeys: 'passthrough'`).
- `encode()` type-checks every field (see "Encode type checks"): a missing
  number, a missing boolean or a wrong literal throws `ProtoEncodeError` with
  the field's path. In 0.2.0 and earlier they were written as `NaN`, `false` and the
  schema's literal. It checks types, not rules: encode values that came out of
  the validator.
- On decode, a field whose value decodes to `undefined` (an absent `optional`
  or `nullish`) is left out of the result, not set to `undefined`, matching
  veta's output (`Object.keys` agree). In 0.2.0 and earlier the key was present.

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

The item schema must take at least one byte: `proto(array(literal("x")))`
throws at compile time ("array whose items encode to zero bytes"), because
decode bounds an array's count by `remaining bytes / minimum item size`.
Minimum sizes: `string`/`boolean`/`uint8array`/`array`/wrappers/`union` 1,
`number` 2, `bigint`/`date` 8, `object`/`tuple` the sum of their fields,
`literal` 0.

```ts
const codec = proto(array(number()));
// [42, 99, 3.14] encodes as:
//   varint(3) + flag(0) + varint(42) + flag(0) + varint(99) + flag(2) + float64(3.14)
```

---

### `tuple`

Elements encoded in order, **no length prefix**. Length is determined by the
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

`encode()` refuses `null` for `optional()` (as the validator does); use
`nullish()` for a field that can be both. Inside an object, an absent field
(decoded `0x00`) is left out of the result.

---

### `nullable`

```ts
const codec = proto(nullable(number()));
// Codec type: number | null
```

Wire: 1-byte presence flag + value if present.
- `0x00` → value is `null`
- `0x01` → value follows

`encode()` refuses `undefined` for `nullable()` (as the validator does), so a
missing nullable key throws `Expected a value or null, got undefined at <key>`.
In 0.2.0 and earlier `undefined` was written as `0x00` and decoded as `null`.

---

### `nullish`

```ts
const codec = proto(nullish(number()));
// Codec type: number | null | undefined, though null is coerced to undefined
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
| `object`, `record` | `typeof val === 'object' && val !== null && !Array.isArray(val)` |
| `array` | `Array.isArray(val)` |
| `literal` | `val === meta.value` |
| `optional/nullable/nullish` | `val === undefined \|\| val === null \|\| <inner matches>` |
| `tuple` | `Array.isArray(val) && val.length === items.length` |
| nested `union` (incl. `picklist`) | one of its own variants matches (the inner union then writes its own index: outer index + inner index) |

Matchers are compiled once per union (cached per `TypeMeta`), not re-derived
per value.

**Order matters:** The first matching variant wins. Declare more specific types
(e.g., `literal`) before general types (e.g., `string`).

**Object variants are discriminated.** With one object variant, it matches any
non-null, non-array object (unchanged). With two or more (counting
`optional/nullable/nullish` wrappers around an object), `proto()` looks for a
key present in every one of them as a `literal()` or `picklist()` whose values
are disjoint across the variants, the same rule `discriminatedUnion()`
enforces, and the first such key in the first object variant's key order is
used. Each object variant then matches only objects whose tag is one of its
values (a wrapped one also matches `null`/`undefined`). A value whose tag is
none of them throws "Value does not match any union variant". No such key →
`proto()` throws "A union has N object variants and no literal field that tells
them apart". In 0.1.32 and earlier, the first object variant always won:
`{ type: "keyup", key: "a" }` was written as a `click`, a credit journal line
as a debit.

**Limits:** at most 256 variants (the index is one byte); more throws at
compile time. In 0.1.32 and earlier, index 256+ wrapped (`ACC-299` decoded as
`ACC-43`).

**Decode:** an index ≥ the variant count throws `ProtoDecodeError`.

**Throws at runtime** if no variant matches:
`"Value does not match any union variant"`

---

### `record`

```ts
const Prices = record(picklist(["IDR", "USD"]), decimal({ scale: 2 }));
const codec = proto(Prices);
codec.encode({ IDR: "15000.00", USD: "1.00" });
// varint(2) + index(0) + "15000.00" + index(1) + "1.00"
```

Wire: `varint(count)` + for each own enumerable key in `Object.keys` order: the
key encoded with the key schema, then the value with the value schema.
Metadata `{ type: 'record', key: TypeMeta, value: TypeMeta }` comes from veta's
`record()` when both halves are described.

**Decode:** the count is bounded by `remaining bytes / (min key size + min value
size)` before anything is read. A key `"__proto__"` throws `ProtoDecodeError`
(`Record key "__proto__" is not allowed`: it would replace the result's
prototype), and so does a repeated key (`Duplicate record key "a"`). The result
is a plain `{}`.

**Encode:** keys and values are type-checked; an error's path is the key
(`Expected number, got string at IDR`). A picklist key outside its options
throws "Value does not match any union variant".

**Unions:** a record counts as an object-like variant with no fields, so a
union of a record and any object (or a second record) is refused by `proto()`.

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
  
  // Use internal encode, then copy, or use a pooled approach
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

`codec.size(val)` computes the exact byte count without allocating (UTF-8
lengths are counted from `charCodeAt`, a lone surrogate as 3 bytes like
`TextEncoder`'s U+FFFD; 1.06–6.7× faster than measuring with `TextEncoder`
for non-ASCII strings). It does not type-check. Use for:
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
// At proto() (compile time):
//   Error("Validator has no schema metadata, so no codec can be built for it...")
//   Error("Cannot create protobuf codec for '<type>'...")                 // any / unknown
//   Error("Cannot create protobuf codec for an array whose items encode to zero bytes...")
//   Error("A union has N object variants and no literal field that tells them apart...")
//   Error("A union (or picklist) has N variants, but the variant index is one byte...")
try {
  const bytes = codec.encode(value);
  // encode(): ProtoEncodeError("Expected number, got string at lines.0.qty")
  //           ProtoEncodeError("Value does not match any union variant at payment")
  //           RangeError("bigint <n> does not fit in the 64-bit signed wire format")
  const decoded = codec.decode(bytes, { validate: true });
  // decode(): ProtoDecodeError (bytes), then VetaError (rules, with validate)
  //           TypeError (validate on an async validator)
} catch (err) {
  if (err instanceof ProtoEncodeError) console.log(err.path);   // ['lines', 0, 'qty']
  if (err instanceof ProtoDecodeError) console.log(err.offset); // byte position
}
```

### Decoding untrusted input

```ts
import { proto, ProtoDecodeError } from "@coderbuzz/proto";
import { object, string, decimal, isVetaError } from "@coderbuzz/veta";
import { HttpError } from "@coderbuzz/velox";

const Invoice = object({ ref: string({ max: 32 }), amount: decimal({ scale: 2 }) });
const codec = proto(Invoice);

function read(bytes: Uint8Array) {
  try {
    return codec.decode(bytes, { validate: true }); // bytes checked by decode, rules by the validator
  } catch (err) {
    if (err instanceof ProtoDecodeError || isVetaError(err)) throw new HttpError(400, "Invalid body");
    throw err;
  }
}
```

Without `validate`, a forged payload decodes `amount` as any string
(`"NaN; DROP"` was accepted in the audit) while typed as a validated decimal.
`Invoice(codec.decode(bytes))` is equivalent and also works for async
validators (`await`).

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

---

## Wire Size Comparison

`proto` is optimized for minimal wire size:

| Payload | JSON | MessagePack | proto |
|---------|------|-------------|-------|
| `{id:1, name:"Ken", active:true}` | 35 B | 22 B | 7 B |
| Benchmark nested object | 139 B | 111 B | 65 B |

Benchmark throughput (Apple M-series, Bun, from `coderbuzz/benchmarks`):

| Operation | JSON | @coderbuzz/proto | @coderbuzz/msgpack | @msgpack/msgpack |
|---|---|---|---|---|
| Encode (ops/s) | 6,892,630 | 4,694,891 | 3,275,386 | 1,323,117 |
| Decode (ops/s) | 3,320,669 | 3,109,557 | 1,231,876 | 1,086,271 |

The savings come from:
1. **No field names**: unlike JSON/MessagePack
2. **No per-value type tags**: unlike MessagePack
3. **Efficient integer encoding**: varint for common ranges

---

## Compilation Internals

`proto(validator)` extracts `TypeMeta` from `validator[METADATA]` and compiles three closures:

### compileEncoder(meta) → `(val: any) => void` (writes to the module-level buffer)

Walk the `TypeMeta` tree and generate write operations:
```
meta.type dispatch:
  "string"    → writeVarint(buf, length) + writeString(buf, val)
  "number"    → writeNumber(buf, val) (flag + varint or float64)
  "boolean"   → writeByte(buf, val ? 1 : 0)
  "bigint"    → DataView.setBigInt64(buf, val)
  "date"      → DataView.setFloat64(buf, val.getTime())
  "uint8array"→ writeVarint(buf, length) + writeBuf(buf, val)
  "object"    → for each key: compileEncoder(shape[key])(buf, val[key])
  "array"     → writeVarint(buf, length); for each item: encodeItem(buf, item)
  "tuple"     → for each item: encodeItem(buf, item) (no length prefix)
  "optional"  → if val==null: write 0x00; else: write 0x01 + encodeInner(val)
  "nullable"  → if val==null: write 0x00; else: write 0x01 + encodeInner(val)
  "nullish"   → if val==null: write 0x00; else: write 0x01 + encodeInner(val)
  "union"     → findMatchingVariant(val); write variantIndex; encodeVariant(val)
  "literal"   → (no-op: value is known)
  "any"/"unknown" → throw (unsupported)
```

### compileDecoder(meta) → `() => any` (reads module-level decode state)

Walk the `TypeMeta` tree and generate read operations, mirroring the encoder:
```
meta.type dispatch:
  "string"    → readVarint(buf) + readString(buf, len)
  "number"    → readNumber(buf) (flag dispatch: varint or float64)
  "boolean"   → buf[pos++] === 1
  "bigint"    → DataView.getBigInt64(buf, pos); pos += 8
  "date"      → new Date(DataView.getFloat64(buf, pos))
  "uint8array"→ readVarint(buf) + buf.slice(pos, pos+len) (copy)
  "object"    → accumulate results via FOR_EACH shape keys
  "array"     → readVarint(len); build array, recurse per item
  "tuple"     → build array via FOR_EACH items (no length read)
  "optional"  → if buf[pos++]===0: undefined; else: decodeInner()
  "nullable"  → if buf[pos++]===0: null; else: decodeInner()
  "nullish"   → if buf[pos++]===0: undefined; else: decodeInner()
  "union"     → variantIndex=buf[pos++]; switch: decodeVariant(variantIndex)
  "literal"   → return meta.value (embedded in closure)
```

### compileSizer(meta) → `(val: any) => number`

Pure arithmetic, identical traversal to encoder but calculates rather than writes:
- Varint sizes use pre-computed `varintSize(val)`.
- String sizes count UTF-8 bytes from `charCodeAt` (1/2/3 bytes per unit, 4 per
  surrogate pair, 3 for a lone surrogate), with no allocation.
- Records: `varintSize(count)` + key and value sizes per entry.
- A `{ header: true }` codec adds 5.
- Object/array sizes sum children recursively.
- Optional/nullable/nullish: +1 byte if present.

### Compilation Model

Compilation happens **once** at `proto(validator)` call time. The closures are cached on the returned `ProtoCodec` object. No runtime schema lookup during encode/decode. The closures are pure JavaScript with inline branch prediction.

### Schema Constraints for Proto

| Veta Feature | Proto Support |
|---|---|
| `coerce(validator)` | Works: coercion happens at **validation** time (before encode), not during serialization. Use veta schema for validation first, proto for binary encoding. |
| `pipe(validators)` | Works: `METADATA` is from the **last** validator in the pipe. Encode uses final value; transformations happen before encoding. |
| `pipe(validators)` caveat | If the last validator has no `METADATA` (custom function), the pipe has none either and `proto()` throws. |
| `objectAsync()` and other async variants | Same `METADATA` as the sync variants (veta 0.5.0): compiles. |
| Custom function validators / `withContext()` | No `METADATA`: throws, as the schema root and inside an `object` (veta 0.5.0 object metadata is all-or-nothing; before that the field was silently dropped). Describe it with `withMeta()`. |
| `discriminatedUnion()` / tagged `union()` of objects | Encoded by the tag field (after 0.1.32). |
| `picklist()` | Union of literals: ≤ 256 options. |
| `record()` | `{ type: 'record', key, value }` metadata when key and value are described: encoded as `varint(count)` + key/value pairs. |
| `lazy()` | No `METADATA` (recursive): throws. |
| `decimal()` | Carries `string` metadata; encoded as a string. |
| `any` / `unknown` | Not supported: throw at compile time. Schema must be fully specified for deterministic wire format. |

### Internal Buffer

Proto has its own encoder buffer (same design as `@coderbuzz/msgpack`, not shared;
proto does not depend on msgpack):
- Single module-level buffer: `buf`, `dv`, `pos`, shared by every codec from `proto()`
- Starts at 64 KB, doubles on overflow, drops back to 64 KB after an encode that took it past 1 MiB
- Each `encode()` returns `buf.slice(0, pos)` (safe copy)
- Thread-safe (JS single-threaded)
- `size()` does NOT use the buffer: pure arithmetic

---

## Limitations

- Schema must be known at both ends: no schema evolution, no unknown-field skipping.
  Without `{ header: true }` nothing in the bytes identifies the schema, so bytes
  encoded with another version are misread, not rejected: swapping the order of
  `debit` and `credit` in the shape makes old bytes decode with the two values
  exchanged; a field added at the end makes an old buffer fail with
  `ProtoDecodeError` (truncated). With the header, any layout change throws
  "Schema fingerprint mismatch". Never persist proto bytes across a schema change.
- Decode checks the bytes (see "Decode checks"); the validator's rules only with
  `{ validate: true }`.
- `nullish` decodes `null` as `undefined` (one presence byte for both; a
  three-state flag is a wire-format change, deferred).
- A union holds at most 256 variants; `bigint` is limited to int64.
- No streaming: entire message in memory.
- ESM only, no CJS build.
- Requires `@coderbuzz/veta` (the only runtime dependency).
