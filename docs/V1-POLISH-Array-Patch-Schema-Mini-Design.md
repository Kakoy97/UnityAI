# V1-POLISH Array Patch Schema Mini-Design

## 1. Scope
- Task: `R17-POLISH-W-00`
- Target command: `set_serialized_property`
- Goal: keep `value_kind=array` and introduce explicit operation intent via `op`.

## 2. Decision
- Adopt **Option A**:
  - `value_kind` stays `array`.
  - Add `op` with enum: `set | insert | remove | clear`.
- Do not introduce pseudo-kinds such as `array_insert` / `array_remove`.

## 3. Patch DTO (v1)

Applicable when `patch.value_kind === "array"`:

```json
{
  "property_path": "m_Items",
  "value_kind": "array",
  "op": "insert",
  "index": 2
}
```

Fields:
- `op`:
  - optional, default `set`
  - allowed values: `set`, `insert`, `remove`, `clear`
- `array_size`:
  - used by `op=set`
  - integer `>= 0`
- `index`:
  - used by `op=insert` and single-index `op=remove`
  - integer `>= 0`
- `indices`:
  - optional batch remove list for `op=remove`
  - non-empty integer array, each `>= 0`

Validation matrix:
- `op=set`: requires `array_size`
- `op=insert`: requires `index`
- `op=remove`: requires `index` or non-empty `indices`
- `op=clear`: no extra field required

## 4. Runtime Semantics
- `set`: assign array size
- `insert`: insert one element at `index`
- `remove`:
  - normalize to index list
  - execute in **descending index order** to avoid shift drift
  - for Unity object-reference arrays, if first delete only nulls slot, delete same index one more time
- `clear`: set `arraySize=0`

## 5. Error Contract
- Schema/parameter issues: `E_SCHEMA_INVALID` / `E_ACTION_SCHEMA_INVALID`
- Type mismatch (non-array target): `E_ACTION_PROPERTY_TYPE_MISMATCH`
- Property missing: `E_ACTION_PROPERTY_NOT_FOUND`

## 6. Dry-Run Compatibility
- For `R17-POLISH-W-02`, array ops follow same validation flow under `dry_run=true`.
- Dry-run must not call `ApplyModifiedProperties()` and must emit per-patch status summary.
