/**
 * domicile bench — run the HnswIndex benchmark suite.
 *
 * PRODUCT_DESIGN.md B9 / TECHNICAL_VALIDATION.md §5. Codifies the validation
 * plan as a reproducible command. Prints recall, latency, delete, and score
 * metrics per scale point, and an overall pass/fail for the quality gate.
 */
import { parseFlags } from '../commands.js';
function parseSizes(raw) {
    const defaultSizes = [
        { size: 1000, dimensions: 128 },
        { size: 10000, dimensions: 128 },
    ];
    if (!raw)
        return defaultSizes;
    // Accept "1k,10k" or "1000,10000".
    return raw.split(',').map((s) => {
        const trimmed = s.trim();
        const mult = /k$/i.test(trimmed) ? 1000 : 1;
        const n = parseInt(trimmed.replace(/k$/i, ''), 10) * mult;
        return { size: n, dimensions: 128 };
    });
}
export async function cmdBench(args) {
    const { values } = parseFlags(args, {
        flags: {
            sizes: 'string',
            dims: 'string',
            queries: 'string',
            k: 'string',
            citation: 'boolean',
            help: 'boolean',
        },
    });
    if (values.help) {
        console.log(`domicile bench — run a benchmark

Modes:
  (default)        HnswIndex recall/latency/delete suite
  --citation       Citation-accuracy suite (TECHNICAL_VALIDATION.md §5): runs the
                   real retrieve + hybrid + rerank stages over a fixed legal
                   known-answer corpus and reports citation recall@k per variant

Options:
  --sizes <1k,10k,50k>   Scale points (default: 1k,10k) [index mode]
  --dims <n>             Vector dimensions (default: 128) [index mode]
  --queries <n>          Queries per scale point (default: 200) [index mode]
  --k <n>                recall@k (default: 10 index, 3 citation)
  --citation             Run the citation-accuracy benchmark
  --help                 Show this help`);
        return 0;
    }
    if (values.citation) {
        return runCitationBenchmark(Number(values.k ?? 3));
    }
    const dims = Number(values.dims ?? 128);
    const sizes = values.sizes
        ? parseSizes(values.sizes).map((s) => ({ ...s, dimensions: dims }))
        : parseSizes(undefined).map((s) => ({ ...s, dimensions: dims }));
    const queries = Number(values.queries ?? 200);
    const k = Number(values.k ?? 10);
    const { benchmarkIndex } = await import('../../index.js');
    console.log('domicile bench — HnswIndex\n');
    let allPass = true;
    for (const scale of sizes) {
        console.log(`\n=== ${scale.size} vectors × ${scale.dimensions}d ===`);
        const result = await benchmarkIndex(scale, {
            queries,
            k,
            onProgress: (m) => console.log(m),
        });
        const status = result.pass ? 'PASS' : 'FAIL';
        if (!result.pass)
            allPass = false;
        console.log(`\n  ${status} — recall@${k}=${result.hnsw.recallAtK.toFixed(3)} insert=${Math.round(result.hnsw.insertThroughputPerSec).toLocaleString()}/s`);
        console.log(`  search p50=${result.hnsw.searchP50Ms.toFixed(2)}ms p99=${result.hnsw.searchP99Ms.toFixed(2)}ms delMedian=${result.hnsw.deleteMedianMs.toFixed(3)}ms realScores=${result.hnsw.hasRealScores}`);
    }
    console.log(`\nOverall: ${allPass ? 'PASS' : 'FAIL'}`);
    return allPass ? 0 : 1;
}
/**
 * Citation-accuracy benchmark (TECHNICAL_VALIDATION.md §5). Runs the real
 * retrieval stages over a fixed legal known-answer corpus and reports
 * citation recall@k per pipeline variant (dense / +hybrid / +rerank / both).
 */
async function runCitationBenchmark(k) {
    const { benchmarkCitationAccuracy } = await import('../../index.js');
    console.log(`domicile bench — citation accuracy (k=${k})\n`);
    const result = await benchmarkCitationAccuracy({
        k,
        onProgress: (m) => console.log(m),
    });
    console.log('\nvariant                 recall@k  meanRank');
    for (const v of result.variants) {
        console.log(`  ${v.variant.padEnd(22)} ${v.citationRecallAtK.toFixed(3).padStart(6)}   ${v.meanExpectedRank.toFixed(2).padStart(7)}`);
    }
    if (result.improvements.length > 0) {
        console.log(`\nPipeline variants that beat dense-only: ${result.improvements.join(', ')}`);
    }
    else {
        console.log('\nNo variant beat dense-only on this corpus (dense is strong on keyword-heavy legal queries).');
    }
    console.log(`Full pipeline beats dense: ${result.pipelineBeatsDense ? 'YES' : 'NO'}`);
    return 0;
}
//# sourceMappingURL=bench.js.map