import { describe, expect, it } from "vitest";
import { capacityFor, valueAt, type SeriesSpec } from "../../scripts/migrate-grafana/dd-feed";

const spec = (metric: string, tags = ["host:demo-01"]): SeriesSpec => ({ metric, type: "g", tags, seed: 0.42 });

describe("feeder values", () => {
  it("keeps resource totals above their used/free parts and in the metric's unit", () => {
    const total = valueAt(spec("system.mem.total"), 5), usable = valueAt(spec("system.mem.usable"), 5), used = valueAt(spec("system.mem.used"), 5);
    expect(total).toBeGreaterThanOrEqual(8192); expect(total).toBeLessThanOrEqual(32768); // MiB
    expect(usable).toBeLessThan(total); expect(used).toBeLessThan(total);
    const size = valueAt(spec("node_filesystem_size_bytes"), 1), avail = valueAt(spec("node_filesystem_avail_bytes"), 1);
    expect(size).toBeGreaterThan(1e10); expect(avail).toBeLessThan(size);
    const cores = valueAt(spec("system.cpu.num_cores"), 1);
    expect(Number.isInteger(cores)).toBe(true); expect(cores).toBeLessThanOrEqual(32);
  });
  it("keeps percentages, ratios and uptime plausible", () => {
    for (let t = 0; t < 50; t++) {
      expect(valueAt(spec("system.cpu.user"), t)).toBeLessThanOrEqual(100);
      expect(valueAt(spec("system.disk.in_use"), t)).toBeLessThanOrEqual(1);
    }
    expect(valueAt(spec("system.uptime"), 10)).toBeGreaterThan(valueAt(spec("system.uptime"), 1));
    expect(capacityFor(spec("system.mem.pct_usable"))).toBeNull();
    expect(capacityFor(spec("kubernetes.cpu.usage.total"))).toBeNull();
  });
});
