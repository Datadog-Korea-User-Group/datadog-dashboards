import { describe, expect, it } from "vitest";
import { normalizeQueryFilters, validateFormula, validateQuery, validateResult, metricOfQuery } from "../../scripts/migrate-grafana/validate";

describe("validateQuery", () => {
  it.each([
    "sum:http_requests.count{$job,code:5*} by {handler}.as_rate()",
    "avg:system.cpu.idle{$node}",
    "avg:system.load.1{$node}.rollup(avg, 600)",
    "p95:http_request_duration_seconds{$job} by {handler}",
    "sum:kubernetes_state.pod.status_phase{$namespace,pod_phase:running}",
    "sum:nginx_ingress.controller.requests{*}.as_rate()",
    "max:kubernetes_state.node.by_condition{condition:ready,status:true}",
    "avg:probe_success{instance:$target.value} by {instance}",
    "sum:x.count{!device:lo,NOT status IN (200,204)} by {host}",
    "sum:x.count{kube_container_name IN (a,b) AND pod_name:istiod-*}",
  ])("accepts %s", (q) => expect(validateQuery(q)).toBeNull());

  it.each([
    "count:foo{*}",
    "avg:job:http_requests:rate5m{*}",
    "avg:foo{label=~\"x\"}",
    "rate(foo[5m])",
    "avg:foo{*} by {le} .rollup(avg 60)",
    "avg:foo{a:b} offset 5m",
  ])("rejects %s", (q) => expect(validateQuery(q)).not.toBeNull());
});

describe("validateFormula", () => {
  it("accepts arithmetic and known functions", () => {
    expect(validateFormula("query1 / query2 * 100", ["query1", "query2"])).toBeNull();
    expect(validateFormula("top(query1, 5, 'mean', 'desc')", ["query1"])).toBeNull();
    expect(validateFormula("default_zero(timeshift(query1, -3600))", ["query1"])).toBeNull();
  });
  it("rejects unknown identifiers, comparisons and unbalanced parens", () => {
    expect(validateFormula("query1 / query3", ["query1"])).toMatch(/unknown identifier/);
    expect(validateFormula("query1 > 0", ["query1"])).toMatch(/comparison/);
    expect(validateFormula("(query1", ["query1"])).toMatch(/unbalanced/);
  });
});

describe("validateResult", () => {
  it("requires queries unless unsupported", () => {
    expect(validateResult({ id: "1", status: "unsupported", queries: [], formula: "", unmappedMetrics: [], notes: [] })).toBeNull();
    expect(validateResult({ id: "1", status: "native", queries: [], formula: "", unmappedMetrics: [], notes: [] })).toMatch(/no queries/);
    expect(validateResult({ id: "1", status: "native", queries: [{ name: "query1", query: "avg:a.b{*}" }, { name: "query1", query: "avg:a.b{*}" }], formula: "query1", unmappedMetrics: [], notes: [] })).toMatch(/duplicate/);
  });
});

describe("normalizeQueryFilters", () => {
  it("joins IN clauses with AND", () => {
    expect(normalizeQueryFilters("sum:m{a IN (x,y),b:c} by {d}")).toBe("sum:m{a IN (x,y) AND b:c} by {d}");
    expect(normalizeQueryFilters("sum:m{a:b,c:d}")).toBe("sum:m{a:b,c:d}");
  });
});

describe("metricOfQuery", () => {
  it("parses metric, filters, by, modifiers", () => {
    const m = metricOfQuery("sum:http_requests.count{$job,code:5*} by {handler,host}.as_rate()");
    expect(m).toMatchObject({ agg: "sum", metric: "http_requests.count", filters: ["$job", "code:5*"], by: ["handler", "host"] });
    expect(m?.modifiers).toContain("as_rate");
  });
});
