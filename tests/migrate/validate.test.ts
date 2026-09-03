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
    // exclusions must be spelled NOT key:value once the list is AND-joined
    expect(normalizeQueryFilters("sum:m{a:*,!b:*,c NOT IN (x,y)}")).toBe("sum:m{a:* AND NOT b:* AND c NOT IN (x,y)}");
    expect(normalizeQueryFilters("sum:m{a:b AND !c:d}")).toBe("sum:m{a:b AND NOT c:d}");
    expect(normalizeQueryFilters("sum:m{!c:d,a:b}")).toBe("sum:m{!c:d,a:b}");
    // concatenated template variables (instance="$app$node") cannot be expressed: the filter is dropped
    expect(normalizeQueryFilters("avg:m{$job,instance:$app$node.value}")).toBe("avg:m{$job}");
    expect(normalizeQueryFilters("avg:m{instance:$app$node.value}")).toBe("avg:m{*}");
    // a single filter is sanitized too
    expect(normalizeQueryFilters("avg:m{executor:docker+machine} by {state}")).toBe("avg:m{executor:docker_machine} by {state}");
    expect(normalizeQueryFilters("avg:m{$job}")).toBe("avg:m{$job}");
    expect(normalizeQueryFilters("avg:m{*}")).toBe("avg:m{*}");
    // interior wildcards, concatenated variables with a separator, `$var.*`, and keys that do not start with a letter
    expect(normalizeQueryFilters("avg:m{$instance,!uri:/**/favicon.ico} by {uri}")).toBe("avg:m{$instance} by {uri}");
    expect(normalizeQueryFilters("sum:m{!resource:/**}")).toBe("sum:m{!resource:/*}");
    expect(normalizeQueryFilters("avg:m{$codebase,$folderFilter/$fileFilter.value}")).toBe("avg:m{$codebase}");
    expect(normalizeQueryFilters("sum:m{$instance,$interface.*} by {interface}")).toBe("sum:m{$instance,$interface} by {interface}");
    expect(normalizeQueryFilters("sum:m{_cluster:$cluster.value,_environment:$environment.value}")).toBe("sum:m{cluster:$cluster.value,environment:$environment.value}");
    expect(normalizeQueryFilters("sum:m{path:/api/*}")).toBe("sum:m{path:/api/*}");
    expect(normalizeQueryFilters("sum:m{$service-*}.as_rate()")).toBe("sum:m{$service}.as_rate()");
    expect(normalizeQueryFilters("avg:m{$instance,$thread.num.*} by {type}")).toBe("avg:m{$instance,$thread} by {type}");
    expect(normalizeQueryFilters("avg:m{*} by {_cluster,host}")).toBe("avg:m{*} by {cluster,host}");
    // wildcards are not allowed inside IN (...): spell them as an OR group; the +Inf bucket is the histogram count
    expect(normalizeQueryFilters("sum:m.count{code IN (4*,5*),verb:get} by {code}")).toBe("sum:m.count{(code:4* OR code:5*) AND verb:get} by {code}");
    expect(normalizeQueryFilters("sum:m{k NOT IN (a*,b),z:1}")).toBe("sum:m{NOT k:a* AND NOT k:b AND z:1}");
    expect(normalizeQueryFilters("sum:m.bucket{$instance,le:+Inf}.as_rate()")).toBe("sum:m.count{$instance}.as_rate()");
    // tag values are lowercased and restricted to the intake charset
    expect(normalizeQueryFilters("avg:jvm{id:\"compressed class space\",name:33-PCI 1 Zone}")).toBe("avg:jvm{id:compressed_class_space,name:33-pci_1_zone}");
    for (const q of ["sum:m{(code:4* OR code:5*) AND verb:get} by {code}", "sum:m{a:* AND NOT b:* AND c NOT IN (x,y)}", "sum:m{NOT k:a* AND z:1}"]) expect(validateQuery(q)).toBeNull();
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
