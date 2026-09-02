import { describe, expect, it } from "vitest";
import { stripUnitScaling } from "../../scripts/migrate-grafana/assemble";

describe("stripUnitScaling", () => {
  it("removes byte/core conversions on native metrics (Datadog scales them from unit metadata)", () => {
    expect(stripUnitScaling("query1 * 1048576", ["system.mem.total"])).toBe("query1");
    expect(stripUnitScaling("(query1 - query2) * 1024 * 1024", ["system.mem.total", "system.mem.usable"])).toBe("(query1 - query2)");
    expect(stripUnitScaling("query1 * 1024", ["system.io.rkb_s"])).toBe("query1");
    expect(stripUnitScaling("query1 / 1e9", ["kubernetes.cpu.usage.total"])).toBe("query1");
    expect(stripUnitScaling("query1 * 1048576 / query2", ["system.mem.used", "system.mem.total"])).toBe("query1 / query2");
  });
  it("leaves OpenMetrics and mixed requests alone", () => {
    expect(stripUnitScaling("query1 * 1024", ["node_memory_kbytes"])).toBe("query1 * 1024");
    expect(stripUnitScaling("query1 / 1e9", ["system.cpu.user", "container_cpu_usage_seconds.count"])).toBe("query1 / 1e9");
    expect(stripUnitScaling("(query1) * 100", ["system.mem.pct_usable"])).toBe("(query1) * 100");
  });
});
