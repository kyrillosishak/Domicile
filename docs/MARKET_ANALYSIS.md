# Domicile — Market Analysis

**The product:** Haven is a complete private AI stack — vector database, local embeddings, RAG pipeline, and LLM — that runs entirely in the browser via WebAssembly and WebGPU, with zero data egress. It is distributed as a single TypeScript library (`npm install haven`) and exposes an MCP interface for agent ecosystems.

**The thesis:** Privacy in AI is currently enforced as policy (configurable, forgettable, audited after the fact). Haven enforces it as architecture — the data physically never leaves the device. That reframing competes against cloud RAG/on-prem vector infrastructure on a different axis than price or speed, and it opens a wedge in regulated verticals where the cost of a leak is asymmetric.

---

## 1. Market context

Haven sits at the intersection of three markets that are each growing fast but have not yet converged in a single product:

**1.1 Vector databases & retrieval infrastructure.** A crowded, well-funded category — Pinecone, Weaviate, Milvus, Qdrant, Chroma, pgvector. All are server-side by design: the database runs somewhere, and embeddings/queries travel to it. Differentiation is mostly about scale, latency, and managed-vs-self-hosted. The unaddressed gap: a vector store whose storage and compute are co-located with the user, requiring no server process to deploy or secure.

**1.2 On-device / local AI.** Catalyzed by Ollama, LM Studio, llama.cpp, WebLLM, and Transformers.js. Momentum is driven by two forces: cost (escaping per-token API economics) and privacy (no third-party processor). The browser is the most constrained but most universally distributed runtime. WebGPU adoption in Chrome/Edge has crossed the threshold where real inference is practical; Firefox/Safari lag, which caps the addressable surface today.

**1.3 Privacy-first AI for regulated industries.** Legal, healthcare, and finance face statutory and contractual obligations (GDPR, attorney-client privilege, HIPAA, sectoral data-residency rules) that make off-device processing of sensitive documents legally and commercially risky. Current answers are either expensive on-prem deployments or SaaS tools whose privacy posture is contractual rather than architectural.

The opportunity Haven targets is the overlap: a *complete* RAG stack (not just an LLM, not just a vector store) that is *architecturally* private because it runs in the browser. No incumbent occupies that exact cell.

---

## 2. Competitive landscape

### 2.1 Cloud vector databases & managed RAG
**Pinecone, Weaviate (cloud), Azure AI Search, OpenAI Assistants, Cohere.**
- *Strength:* scale, operational maturity, mature ecosystems.
- *Weakness:* data leaves the device; privacy is a contract and a config, not a boundary. Per-seat/per-token economics. Not viable for privilege-protected workflows without heavy DPA negotiation.
- *Haven's edge:* zero egress by construction. No DPA needed because there is no processor.

### 2.2 Self-hosted / on-prem vector DBs
**Qdrant, Milvus, Weaviate (self-hosted), pgvector, LanceDB.**
- *Strength:* data stays on infrastructure the firm controls. Battle-tested at scale.
- *Weakness:* someone must provision, patch, back up, and secure a server fleet. For a 20-attorney firm, that is a non-trivial operational burden and a real attack surface. The "on-prem" boundary still implies a network hop between the client and the database.
- *Haven's edge:* no infrastructure to deploy or maintain. The boundary is the device itself, which is stricter and cheaper than on-prem for the mid-market firms that can't afford a real on-prem practice.

### 2.3 Local LLM runtimes
**Ollama, LM Studio, llama.cpp.**
- *Strength:* mature, fast, broad model support on the desktop.
- *Weakness:* desktop application, not embeddable in a web/electron app. No vector database or RAG pipeline — they are an LLM primitive, not a stack. Not browser-portable.
- *Haven's edge:* ships as a library inside the app the firm already uses; bundles the retrieval layer Ollama lacks.

### 2.4 In-browser AI primitives
**WebLLM, Transformers.js.**
- *Strength:* run models in the browser; credible, actively developed.
- *Weakness:* these are building blocks. WebLLM is an LLM runner; Transformers.js is an embedding runner. Neither provides persistent vector storage, a RAG pipeline, metadata filtering, or an agent protocol. An integrator must assemble and maintain the glue.
- *Haven's edge:* Haven *uses* these under the hood but wraps them into a complete, typed custody pipeline with MCP exposure. It is the productized layer above the primitives.

### 2.5 Legal-tech AI SaaS
**Lexemo, Harvey, Casetext (Thomson Reuters), and vertical RAG tools.**
- *Strength:* purpose-built legal UX, matter management integration, tuned workflows.
- *Weakness:* predominantly cloud-delivered, per-seat pricing, and a privacy posture that depends on vendor compliance rather than architecture. The integrator/reseller channel has limited ability to differentiate or customize custody.
- *Haven's edge:* Haven explicitly targets the *integrators* who deploy for these firms (see §3.2), giving them a stack they can embed and brand rather than resell a black box. The README already cites Lexemo as a production deployment, anchoring credibility in this exact segment.

### 2.6 Embedded / in-process vector search
**sqlite-vec / sqlite-vss, LanceDB (embedded), hnswlib.**
- *Strength:* embedded, no server process.
- *Weakness:* run in a server or native process, not the browser sandbox. No bundled LLM or RAG. Not browser-portable.
- *Haven's edge:* same "no server" property but inside the browser — usable in a web app, PWA, or Electron without a native backend.

### 2.7 Positioning summary

| Competitor class | Private by… | Deploys as | Complete RAG stack? | Browser-native? |
|---|---|---|---|---|
| Cloud vector DBs | contract/config | managed service | partial | no |
| On-prem vector DBs | infrastructure control | server fleet | partial | no |
| Local LLM runtimes | local process | desktop app | no (LLM only) | no |
| In-browser AI primitives | architecture | JS library | no (building blocks) | yes |
| Legal-tech AI SaaS | contract | SaaS | yes | no |
| Embedded vector libs | process locality | native lib | no | no |
| **Haven** | **architecture (device-only)** | **single JS lib** | **yes** | **yes** |

Haven is the only entrant occupying "complete stack + browser-native + architecturally private." That cell is defensible precisely because it is hard to assemble from primitives and unattractive to cloud incumbents whose business model depends on data flowing through their infrastructure.

---

## 3. Segments & buyer personas

### 3.1 Law firms & legal teams (primary demand-side)
The showcase's headline buyer. Drivers: privilege protection, GDPR/sectoral residency, offline use in courtrooms and client sites, document Q&A grounded in matter files with citations. They *cannot* tolerate egress but *cannot* afford a real on-prem build. Haven's value proposition — "privilege protection without per-seat cloud fees" and "works offline" — maps directly to pain these firms pay to solve today via SaaS or manual review.

**Buyer:** managing partner / IT director at a mid-market firm (roughly 10–200 attorneys).
**Objection to overcome:** model quality. In-browser models lag frontier cloud models. Haven's honest answer is that for grounded matter-document Q&A with citations, a local 7B-class model is sufficient and the auditability/custody benefit dominates.

### 3.2 Integration & infrastructure teams (primary supply-side / channel)
The second persona the site calls out explicitly. These are the consultancies and internal platform teams that deploy custody solutions *for* regulated firms. Their pain: provisioning and securing on-prem infrastructure is expensive and slow; reselling a cloud SaaS erodes their margin and their differentiation. Haven gives them a stack they embed, configure, brand, and hand off — turning a hosting burden into a software-integration practice.

**Buyer:** technical founder / delivery lead at a legal-tech integrator or an enterprise platform team.
**Why this matters strategically:** this segment is the distribution channel. Each integrator that standardizes on Haven brings a portfolio of firm clients, compounding adoption without Haven doing direct enterprise sales.

### 3.3 Adjacent regulated verticals (expansion)
Healthcare (HIPAA), finance (data-residency, insider-data walls), government contractors, and HR/compliance. Same architectural-privacy argument applies; Haven's current copy is legal-first but the architecture is vertical-agnostic. These are later-phase expansion, not day-one focus.

### 3.4 Privacy-conscious developers & offline-first apps (long tail)
Browser extensions, Electron apps, PWAs that want local semantic search or RAG without a backend. Lower ACV, higher volume, useful for npm adoption, issue velocity, and ecosystem credibility. This is the open-source flywheel, not the revenue core.

---

## 4. SWOT

**Strengths**
- Architecturally private — a boundary, not a policy. Hard to replicate as a bolt-on.
- Complete stack (vector DB + embeddings + RAG + LLM + MCP) in one library; competitors offer pieces.
- Zero infrastructure burden — uniquely attractive to mid-market firms and integrators.
- TypeScript-native, fully typed, MIT-licensed — low friction to evaluate and embed.
- Production credibility via the Lexemo reference.
- MCP integration positions Haven inside the emerging agent-protocol ecosystem rather than against it.

**Weaknesses**
- Browser model quality is below frontier cloud LLMs; grounded tasks are fine, open-ended generation is not.
- WebGPU availability is Chrome/Edge-only today; Firefox/Safari users get the slower WASM path, capping the surface.
- In-browser scale is bounded (100K+ documents cited, but not millions); large corpora hit device memory and IndexedDB quotas.
- Single-device residency means no native cross-device sync or shared team index without the integrator building it.
- Brand recognition is near-zero vs. funded incumbents; the "Haven" vs "Domicile" naming in the repo vs. showcase signals positioning is still settling.
- 0.1.0 maturity — APIs and performance characteristics may shift; enterprise buyers will want stability signals.

**Opportunities**
- MCP adoption is accelerating; being the custody layer agents call *first* is a strong land.
- Regulatory pressure (EU AI Act, expanding residency rules, privilege scrutiny) is a tailwind that increases the cost of cloud-only solutions every year.
- WebGPU is shipping in more browsers and more devices ship capable GPUs — the performance ceiling rises passively.
- React hooks, Python (PyScript) bindings, hybrid search, and multimodal embeddings are on the roadmap and each unlocks a new buyer.
- Integrator channel: a few marquee deployments compound into a category-defining "private RAG for regulated work" position.

**Threats**
- Cloud incumbents could add "zero-retention" / on-device modes, eroding the architectural-distinction argument with a good-enough policy story.
- Browser vendors could ship first-party on-device AI (e.g., Chrome's built-in APIs) that commoditizes the inference layer.
- Local-LLM runtimes (Ollama et al.) could add a vector/RAG layer and extend into the browser, closing the completeness gap.
- Legal-tech SaaS incumbents with existing firm relationships can out-distribute Haven regardless of architectural superiority.
- "Good enough" privacy from established vendors with strong DPAs may win deals where the buyer won't bear the model-quality tradeoff.

---

## 5. Differentiation & defensibility

The defensible core is not any single component — WebLLM, Transformers.js, and HNSW indexing are all open and available to anyone. Defensibility comes from the *integration* and the *positioning*:

1. **The assembled custody pipeline.** Glueing storage, indexing, embeddings, generation, error handling, caching, and MCP into one typed, tested, documented library is real work that integrators would otherwise repeat per engagement. First-mover completeness is a moat against primitives-only competitors.
2. **The architectural-privacy framing.** "Privilege isn't a policy you configure — it's a boundary you build" is a positioning incumbents structurally cannot copy without abandoning their data-flowing business model. This converts a technical property into a category claim.
3. **The integrator channel.** Distribution through teams that deploy for multiple firms compounds; each deployment hardens the stack and produces referenceable proof. This is harder to dislodge than direct firm-by-firm sales.

The moat is shallow against a well-funded competitor that commits to the same cell (complete + browser-native + architecturally private). Speed to category ownership and channel lock-in are therefore the strategic priorities, not feature breadth for its own sake.

---

## 6. Market sizing (directional)

Hard market data for the exact "in-browser private RAG" cell does not exist; the figures below are directional, framed against adjacent reported markets.

- **TAM (regulated, privacy-sensitive AI/automation):** the broader legal-tech + regtech AI opportunity is large and growing double digits; the share addressable by an architectural-privacy approach is a meaningful slice of that.
- **SAM (mid-market regulated firms + their integrators, browser-deliverable):** a subset where device residency is acceptable and WebGPU is available — this is the realistic near-term beachhead, primarily legal-first.
- **SOM (year 1–2):** a handful of integrator-led deployments (Lexemo-class) plus long-tail npm adoption. Modest in revenue, disproportionate in reference value.

The strategic read: the TAM is real and growing, but the *near-term* monetizable surface is narrow because it is gated by (a) WebGPU penetration, (b) buyer willingness to accept local model quality, and (c) channel development. Plan for a multi-year land via the integrator channel rather than a broad direct-sales push.

---

## 7. Risks to the thesis & how to test them

- **Model-quality ceiling:** validate that grounded, citation-backed Q&A on matter documents meets the accuracy bar firms require vs. a cloud frontier model. Run a side-by-side on real (sanitized) corpora.
- **Browser scale limits:** stress-test the 100K-document claim against real firm corpora and IndexedDB quotas across Chrome/Safari/Firefox to find the true ceiling before promising it.
- **"Good enough" cloud privacy:** talk to buyers about whether zero-retention cloud modes satisfy their counsel; if yes, the architectural argument needs to be sharper (auditability, no-DPA, offline) to win.
- **Channel readiness:** confirm integrators see Haven as enabling their practice rather than commoditizing it; their incentive to adopt is the load-bearing assumption.

---

## 8. Strategic recommendations

1. **Own the category name.** Commit to one brand (resolve Haven vs. Domicile) and stake the phrase "architectural privacy" / "in-browser residency" before a competitor does. Positioning clarity is currently the cheapest moat.
2. **Lead with the integrator channel.** A few referenceable deployments compound faster than direct firm sales and build the distribution moat. Productize what an integrator needs: residency config, export/import for hand-off, MCP tools.
3. **Nail the grounded-Q&A quality story.** The model-quality objection is the #1 deal risk. Publish benchmarks and case studies focused on citation accuracy and auditability, not raw generation quality.
4. **Hedge the WebGPU gap.** Keep the WASM fallback genuinely usable and communicate the device matrix honestly; do not oversell where Safari/Firefox users will be disappointed.
5. **Stay inside the MCP ecosystem, not against it.** Being the custody layer agents call first is a better land than competing with agent frameworks. Invest in first-class MCP ergonomics.
6. **Sequence verticals.** Win legal (privacy + offline + privilege), then expand to healthcare/finance with the same architectural-privacy argument and channel model. Avoid diluting focus across verticals simultaneously.

---

*This analysis reflects the product as described in the README and showcase site (v0.1.0). Market sizing is directional, not quoted from a cited source, and should be tightened with primary buyer research before informing funding or go-to-market spend.*
