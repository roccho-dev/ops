from package_lib_level_governance.core import classify_package, classify_records, compare_with_baseline


def record(package_id, definition, status="accepted"):
    return {"packageId": package_id, "status": status, "definition": {"packageId": package_id, "status": status, **definition}}


def test_core_port_lib_meets_target():
    r = record("thing-core-port", {"packageRole": "implementation", "publicInterface": {"version": "v1"}, "responsibility": "core domain rules and port boundary contract"})
    assert classify_package(r).classification == "MEETS_TARGET_LIB_LEVEL"


def test_adapter_needs_example_usecase_when_no_fixture():
    r = record("thing-http-adapter", {"packageRole": "implementation", "responsibility": "http adapter maps runtime host to port"})
    c = classify_package(r)
    assert c.classification == "ADAPTER_NEEDS_EXAMPLE_USECASE"
    assert c.disposition == "accepted-baseline-debt"


def test_adapter_with_e2e_fixture_is_ok_as_extension():
    r = record("thing-cli-adapter", {"packageRole": "implementation", "responsibility": "cli adapter maps runtime host to port", "packageContents": ["examples/usecases/e2e fixture"]})
    assert classify_package(r).classification == "ADAPTER_OK_AS_EXTENSION"


def test_missing_baseline_fails_admission():
    rows = classify_records([record("new-core-port", {"publicInterface": {"version": "v1"}, "responsibility": "core and port"})])
    comparison = compare_with_baseline(rows, [], mode="admission")
    assert comparison["ok"] is False
    assert comparison["errors"][0]["kind"] == "missing-baseline"

if __name__ == "__main__":
    test_core_port_lib_meets_target()
    test_adapter_needs_example_usecase_when_no_fixture()
    test_adapter_with_e2e_fixture_is_ok_as_extension()
    test_missing_baseline_fails_admission()
    print("package-lib-level-governance tests pass")
