<!-- docs: sync from coderbuzz/codex@0063efc -->

# Proto &mdash; `@coderbuzz/proto`

Schema-driven binary serialization for TypeScript — Protobuf-style encoding
without `.proto` files.

Compiles high-performance binary codecs from [Ken (`@coderbuzz/kyo`)](../kyo)
schema validators at runtime.

## Highlights

- No `.proto` files — schemas defined using existing `@coderbuzz/kyo` validators
- No per-value type tags — schema provides type info, so wire format is minimal
- No field name encoding — fixed field order from schema keys
- Compact varint encoding for integers
- Single-byte booleans
- `size()` method for pre-calculating encoded byte length without allocating
- Significantly smaller output than JSON and MessagePack for structured data

## Wire Format

| Type                                | Encoding                                               |
| ----------------------------------- | ------------------------------------------------------ |
| `string`                            | `varint(byteLength)` + UTF-8 bytes                     |
| `number` (int)                      | 1-byte flag (`0`=uint, `1`=neg) + unsigned varint      |
| `number` (float)                    | 1-byte flag (`2`) + 8-byte float64                     |
| `boolean`                           | 1 byte (`0x00` or `0x01`)                              |
| `bigint`                            | 8 bytes (int64 big-endian)                             |
| `date`                              | 8 bytes (float64 timestamp ms)                         |
| `uint8array`                        | `varint(length)` + raw bytes                           |
| `object`                            | fields in schema key order (no tags, no length prefix) |
| `array`                             | `varint(count)` + elements                             |
| `tuple`                             | elements in order (count known from schema)            |
| `optional` / `nullable` / `nullish` | 1-byte presence flag + value if present                |
| `union`                             | 1-byte variant index + encoded variant                 |
| `literal`                           | 0 bytes (value known from schema)                      |

## Installation

```sh
# npm
npm install @coderbuzz/proto @coderbuzz/kyo

# Bun
bun add @coderbuzz/proto @coderbuzz/kyo

# Deno
import { proto } from "npm:@coderbuzz/proto";
import { object, string } from "npm:@coderbuzz/kyo";
```

## Usage

### Basic Example

```ts
import { array, boolean, number, object, string } from "@coderbuzz/kyo";
import { proto } from "@coderbuzz/proto";

const User = object({
  id: number(),
  name: string(),
  active: boolean(),
});

const UserCodec = proto(User);

// Encode
const bytes = UserCodec.encode({ id: 1, name: "Alice", active: true });
// => Uint8Array (compact binary — no field names, no syntax overhead)

// Decode
const user = UserCodec.decode(bytes);
// => { id: 1, name: 'Alice', active: true }

// Pre-calculate size
const size = UserCodec.size({ id: 1, name: "Alice", active: true });
```

### Nested Objects

```ts
import { array, number, object, optional, string } from "@coderbuzz/kyo";
import { proto } from "@coderbuzz/proto";

const Post = object({
  id: number(),
  title: string(),
  tags: array(string()),
  author: optional(string()),
});

const PostCodec = proto(Post);

const bytes = PostCodec.encode({
  id: 42,
  title: "Hello",
  tags: ["ts", "binary"],
  author: undefined,
});
const post = PostCodec.decode(bytes);
```

### Union Types

```ts
import { literal, number, object, string, union } from "@coderbuzz/kyo";
import { proto } from "@coderbuzz/proto";

const Shape = union([
  object({ kind: literal("circle"), radius: number() }),
  object({ kind: literal("rect"), width: number(), height: number() }),
]);

const ShapeCodec = proto(Shape);

const bytes = ShapeCodec.encode({ kind: "circle", radius: 10 });
const shape = ShapeCodec.decode(bytes);
```

## API

```ts
// Compile a binary codec from a Ken schema validator
function proto<T>(validator: (val: any, ctx?: any) => T): ProtoCodec<T>;

interface ProtoCodec<T> {
  // Encode a value to compact binary
  encode(value: T): Uint8Array;
  // Decode binary back to a value
  decode(buffer: Uint8Array): T;
  // Calculate encoded byte size without allocating
  size(value: T): number;
}
```

> **Note:** `any` and `unknown` schema types are not supported — the schema must
> be fully specified for the codec to compile.

## License

MIT © 2026 Indra Gunawan
