/**
 * TombstoneLog — BitSet-based delete log for an HNSW index.
 *
 * Why tombstones instead of rebuild?
 *  - delete is O(1)
 *  - read: post-filter candidates against the bitset
 *  - compact: rebuild the graph from live items; triggered when
 *    deletions × ratio crosses a threshold (default 30 %)
 *
 * Borrowed concept from Vectra + LanceDB; ours is purpose-built for the
 * label↔id mapping `HnswBackedIndex` uses.
 */
export class TombstoneLog {
    constructor() {
        this.bits = new Uint8Array(0);
        this.bitsCount = 0; // count of 1-bits roughly tracked
        this.capacity = 0; // current label capacity
    }
    ensureCapacity(label) {
        const required = label + 1;
        if (required <= this.capacity) {
            return;
        }
        // grow by power-of-two to keep amortized cost O(1)
        let newCap = this.capacity === 0 ? 16 : this.capacity;
        while (newCap < required)
            newCap *= 2;
        const next = new Uint8Array(Math.ceil(newCap / 8));
        next.set(this.bits);
        this.bits = next;
        this.capacity = newCap;
    }
    set(label, value) {
        this.ensureCapacity(label);
        const byte = label >> 3;
        const mask = 1 << (label & 7);
        const prev = (this.bits[byte] & mask) !== 0 ? 1 : 0;
        if (prev === value)
            return;
        if (value === 1)
            this.bits[byte] |= mask;
        else
            this.bits[byte] &= ~mask;
        this.bitsCount += value - prev;
    }
    get(label) {
        if (label >= this.capacity)
            return false;
        const byte = label >> 3;
        const mask = 1 << (label & 7);
        return (this.bits[byte] & mask) !== 0;
    }
    count() {
        return this.bitsCount;
    }
    /**
     * Live label list, ignoring bits set in the tombstones.
     * `liveLabels` is filled by the caller.
     */
    collectLive(allLabels, out) {
        for (const label of allLabels) {
            if (!this.get(label))
                out.push(label);
        }
    }
    serialize() {
        // header: capacity (u32), count (u32), bits bytes
        const out = new Uint8Array(8 + this.bits.length);
        const dv = new DataView(out.buffer);
        dv.setUint32(0, this.capacity, true);
        dv.setUint32(4, this.bitsCount, true);
        out.set(this.bits, 8);
        return out;
    }
    load(bytes) {
        if (bytes.length < 8)
            throw new Error('TombstoneLog: header too short');
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const cap = dv.getUint32(0, true);
        const count = dv.getUint32(4, true);
        const data = bytes.slice(8);
        if (data.length * 8 < count) {
            throw new Error('TombstoneLog: data length inconsistent');
        }
        this.capacity = cap;
        this.bitsCount = count;
        this.bits = data;
    }
    clear() {
        this.bits = new Uint8Array(0);
        this.capacity = 0;
        this.bitsCount = 0;
    }
}
//# sourceMappingURL=TombstoneLog.js.map