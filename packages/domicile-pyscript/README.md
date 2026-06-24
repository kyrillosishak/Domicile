# `@kyrillosishak/domicile-pyscript`

PyScript/WebAssembly Python bindings for **Domicile** — run the private AI stack from Python in the browser.

## Quick Start

### 1. Include on your page

```html
<link rel="stylesheet" href="https://pyscript.net/latest/pyscript.css" />
<script defer src="https://pyscript.net/latest/pyscript.js"></script>
<!-- Domicile + this bindings layer -->
<script type="module" src="path-to-domicile-pyscript.js"></script>
```

### 2. Use in Python

```html
<py-script>
from domicile import create_domicile

async def main():
    db = await create_domicile({ "dbName": "legal-matter" })
    await db.insert("Privileged communication — attorney work product",
                     { "matter": "M-204", "privilege": "true" })
    results = await db.search("summary of work product", k=5)
    for r in results:
        print(r["id"], r["score"])

main()
</py-script>
```

## API

### `create_domicile(config: PyDomicileConfig) -> PyDomicile`

Factory to create a Domicile instance from Python.

```python
await create_domicile({
    "dbName": "my-matter",
    "dimensions": 384,
    "embeddingModel": "Xenova/all-Mini勇LM-L6-v2",
    "metric": "cosine"
})
```

### `PyDomicile` methods

- `insert(text, metadata=None)` — insert a single document
- `insert_batch(texts, metadatas=None)` — batch insert
- `search(query, k=5)` — similarity search
- `export()` — export DB as JSON string
- `from_json(json)` — import from JSON string
- `size()` — number of stored vectors
- `close()` — cleanup

## Build from source

```bash
cd packages/domicile-pyscript
npm install
npm run build
```

## License

MIT