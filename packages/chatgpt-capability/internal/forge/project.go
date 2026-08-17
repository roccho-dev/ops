package forge

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"html"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

const capforgeVersion = "capforge/1"

type ProjectOptions struct {
	Root string
	Dist string
}

func Version() string { return capforgeVersion }

func Project(options ProjectOptions) (BuildReceipt, error) {
	root := options.Root
	if root == "" {
		root = "."
	}
	dist := options.Dist
	if dist == "" {
		dist = filepath.Join(root, "dist")
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return BuildReceipt{}, err
	}
	distAbs, err := filepath.Abs(dist)
	if err != nil {
		return BuildReceipt{}, err
	}
	if filepath.Clean(distAbs) == filepath.Clean(rootAbs) {
		return BuildReceipt{}, fmt.Errorf("dist cannot equal root")
	}

	receipt := newBuildReceipt()
	receipt.Root = "repo://."
	if rel, relErr := filepath.Rel(rootAbs, distAbs); relErr == nil && !strings.HasPrefix(rel, "..") {
		receipt.Dist = "dist://" + filepath.ToSlash(rel)
	} else {
		receipt.Dist = "dist://external"
	}
	receipt.GoVersion = runtime.Version()

	decisions, allDecisions, err := loadDecisions(rootAbs)
	if err != nil {
		return receipt, err
	}
	dirs, err := implementationDirs(rootAbs)
	if err != nil {
		return receipt, err
	}

	if err := os.RemoveAll(distAbs); err != nil {
		return receipt, err
	}
	if err := os.MkdirAll(distAbs, 0o755); err != nil {
		return receipt, err
	}
	if err := copyPlatformAssets(distAbs); err != nil {
		return receipt, err
	}

	implementations := map[string]ImplementationClaim{}
	payloads := map[string][]byte{}

	// The currently running capforge executable is projected as its own immutable Capability.
	executablePath, err := os.Executable()
	if err != nil {
		return receipt, err
	}
	capforgeBytes, err := os.ReadFile(executablePath)
	if err != nil {
		return receipt, err
	}
	capforgeFixture := &Fixture{Schema: FixtureSchema, Args: []string{"version"}, Stdout: capforgeVersion + "\n", Stderr: "", ExitCode: 0, TimeoutMS: 2000}
	capforgeFixtureResult := runFixture(executablePath, capforgeFixture)
	capforgeImpl := systemImplementation("capforge", capforgeBytes, "native", "linux-amd64-static", "", capforgeFixture, capforgeFixtureResult)
	if capforgeFixtureResult.Status != "PASS" {
		capforgeImpl.BuildStatus = "FAIL"
		capforgeImpl.Error = capforgeFixtureResult.Error
	}
	implementations[capforgeImpl.ID] = capforgeImpl
	payloads[capforgeImpl.ID] = capforgeBytes

	searchBytes, err := asset("runtime/registry-search.wasm")
	if err != nil {
		return receipt, err
	}
	if len(searchBytes) < 8 || !bytes.Equal(searchBytes[:4], []byte{0x00, 0x61, 0x73, 0x6d}) {
		return receipt, fmt.Errorf("embedded registry-search.wasm is missing or invalid")
	}
	searchSHA := shaHex(searchBytes)
	searchRawRel := filepath.ToSlash(filepath.Join("raw", "wasm", searchSHA+".wasm"))
	if err := writeFile(filepath.Join(distAbs, filepath.FromSlash(searchRawRel)), searchBytes, 0o644); err != nil {
		return receipt, err
	}
	searchImpl := systemImplementation("registry-search", searchBytes, "wasm", "js", "./"+searchRawRel, nil, nil)
	implementations[searchImpl.ID] = searchImpl
	payloads[searchImpl.ID] = searchBytes

	// Only adopted implementations are built. Unadopted directories are observed but never executed.
	ids := make([]string, 0, len(decisions))
	for id := range decisions {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		if id == "capforge" || id == "registry-search" {
			continue
		}
		decision := decisions[id]
		if decision.Action != "adopt" {
			continue
		}
		at := normalizeAt(id, decision.At)
		capDir := filepath.Join(rootAbs, filepath.FromSlash(at))
		if !pathWithin(rootAbs, capDir) {
			impl := ImplementationClaim{Schema: ImplementationSchema, ID: id, At: at, Language: "Go", Kind: "native", Target: "linux-amd64-static", BuildStatus: "FAIL", Error: "placement escapes root"}
			implementations[id] = impl
			continue
		}
		info, statErr := os.Stat(capDir)
		if statErr != nil || !info.IsDir() {
			continue
		}
		impl, reused := buildCapability(rootAbs, id, at, capDir)
		if reused {
			receipt.ReusedCount++
		} else {
			receipt.BuiltCount++
		}
		implementations[id] = impl
		if impl.PayloadSHA256 != "" {
			payload, readErr := os.ReadFile(cachedPayloadPath(rootAbs, impl.SourceDigest))
			if readErr != nil {
				impl.BuildStatus = "FAIL"
				impl.Error = readErr.Error()
				implementations[id] = impl
			} else {
				payloads[id] = payload
			}
		}
	}

	// Observe unadopted directories without compiling or running them.
	for id := range dirs {
		if _, known := decisions[id]; known {
			continue
		}
		implementations[id] = ImplementationClaim{
			Schema: ImplementationSchema, ID: id, At: filepath.ToSlash(filepath.Join("capabilities", id)),
			Language: "Go", Kind: "native", Target: "linux-amd64-static", BuildStatus: "NOT_RUN", Error: "no adopt decision; implementation not built",
		}
	}

	// Optional projection hooks are declared inside a Capability directory and
	// are executed only after its payload and fixture have passed. The hook may
	// write only declared files beneath dist; their hashes become observed facts.
	projectionIDs := make([]string, 0, len(payloads))
	for id := range payloads {
		projectionIDs = append(projectionIDs, id)
	}
	sort.Strings(projectionIDs)
	for _, id := range projectionIDs {
		capDir, ok := dirs[id]
		if !ok {
			continue
		}
		impl := implementations[id]
		if impl.BuildStatus != "PASS" {
			continue
		}
		projection := runProjection(rootAbs, distAbs, cachedPayloadPath(rootAbs, impl.SourceDigest), capDir)
		if projection == nil {
			continue
		}
		receipt.ProjectionCount++
		impl.Projection = projection
		if projection.Status != "PASS" {
			impl.BuildStatus = "FAIL"
			impl.Error = "projection: " + projection.Error
		}
		implementations[id] = impl
	}

	// Create content-addressed carriers from all successfully materialized payloads.
	payloadIDs := make([]string, 0, len(payloads))
	for id := range payloads {
		payloadIDs = append(payloadIDs, id)
	}
	sort.Strings(payloadIDs)
	for _, id := range payloadIDs {
		impl := implementations[id]
		if err := writeCarrier(distAbs, &impl, payloads[id]); err != nil {
			return receipt, err
		}
		implementations[id] = impl
	}

	records := reconcile(decisions, implementations, dirs)
	decisionValues := make([]any, 0, len(allDecisions))
	for i := range allDecisions {
		decisionValues = append(decisionValues, allDecisions[i])
	}
	implementationValues := sortedImplementationValues(implementations)
	implementationAny := make([]any, 0, len(implementationValues))
	for i := range implementationValues {
		implementationAny = append(implementationAny, implementationValues[i])
	}
	registryAny := make([]any, 0, len(records))
	for i := range records {
		registryAny = append(registryAny, records[i])
	}
	wellKnown := filepath.Join(distAbs, ".well-known")
	if err := writeJSONL(filepath.Join(wellKnown, "decisions.jsonl"), decisionValues); err != nil {
		return receipt, err
	}
	if err := writeJSONL(filepath.Join(wellKnown, "implementations.jsonl"), implementationAny); err != nil {
		return receipt, err
	}
	if err := writeJSONL(filepath.Join(wellKnown, "registry.jsonl"), registryAny); err != nil {
		return receipt, err
	}

	// Generate a deterministic source kit after cache population so unchanged Capability builds are reusable.
	kitTemp := filepath.Join(distAbs, "kit", "source-kit.tmp.zip")
	if err := writeSourceZip(rootAbs, kitTemp); err != nil {
		return receipt, err
	}
	kitSHA, kitBytes, err := fileSHA(kitTemp)
	if err != nil {
		return receipt, err
	}
	kitRawRel := filepath.ToSlash(filepath.Join("kit", kitSHA+".source.zip"))
	kitRawPath := filepath.Join(distAbs, filepath.FromSlash(kitRawRel))
	if err := os.Rename(kitTemp, kitRawPath); err != nil {
		return receipt, err
	}
	kitData, err := os.ReadFile(kitRawPath)
	if err != nil {
		return receipt, err
	}
	kitCarrierRel := kitRawRel + ".b64.txt"
	if err := writeFile(filepath.Join(distAbs, filepath.FromSlash(kitCarrierRel)), []byte(base64.StdEncoding.EncodeToString(kitData)), 0o644); err != nil {
		return receipt, err
	}

	capforgeImpl = implementations["capforge"]
	searchImpl = implementations["registry-search"]
	bootstrap := Bootstrap{
		Schema: BootstrapSchema,
		Protocol: map[string]any{
			"version": ProtocolVersion, "codec": "base64-standard", "padding": "required", "whitespace": "forbidden",
			"integrity": "sha256-of-decoded-payload", "path": "/cap/v1/{kind}/{target}/{payload-sha256}.b64.txt",
		},
		Entrypoints: map[string]string{
			"human": "./", "agent": "./agent.html", "registry": "./.well-known/registry.jsonl",
			"decisions": "./.well-known/decisions.jsonl", "implementations": "./.well-known/implementations.jsonl",
			"instructions": "./agent-add.txt", "proof": "./proof/manifest.json",
		},
		Capforge:  ArtifactRef{Kind: capforgeImpl.Kind, Target: capforgeImpl.Target, PayloadSHA256: capforgeImpl.PayloadSHA256, PayloadBytes: capforgeImpl.PayloadBytes, CarrierPath: capforgeImpl.CarrierPath},
		Search:    ArtifactRef{Kind: searchImpl.Kind, Target: searchImpl.Target, PayloadSHA256: searchImpl.PayloadSHA256, PayloadBytes: searchImpl.PayloadBytes, CarrierPath: searchImpl.CarrierPath, RawPath: searchImpl.RawPath},
		SourceKit: SourceKitRef{SHA256: kitSHA, Bytes: kitBytes, RawPath: "./" + kitRawRel, CarrierPath: "./" + kitCarrierRel},
		Release:   DefaultReleaseNaming(),
		Limits:    map[string]int64{"carrierBytes": 8 * 1024 * 1024, "decodedBytes": 32 * 1024 * 1024},
		Facts: map[string]interface{}{
			"platformBuiltOnce": true, "unchangedCapabilityBuildsUseContentCache": true,
			"newCapabilityChangesCentralRegistry": false, "sourceLanguage": "Go", "browserAdapter": "JavaScript", "searchCore": "Go WebAssembly",
			"newOrChangedCapabilityRequiresGoToolchain": true, "unchangedCapabilityRequiresGoToolchain": false,
		},
		Workflow: []map[string]any{
			{"step": 1, "action": "fetch_text", "path": capforgeImpl.CarrierPath},
			{"step": 2, "action": "base64_decode_and_sha256_verify", "sha256": capforgeImpl.PayloadSHA256},
			{"step": 3, "action": "chmod_and_run", "args": []string{"version"}},
			{"step": 4, "action": "fetch_source_kit", "path": "./" + kitCarrierRel, "sha256": kitSHA},
			{"step": 5, "action": "run_capforge", "args": []string{"add", "--root", ".", "--id", "<id>", "--title", "<title>", "--purpose", "<purpose>", "--message", "<message>"}},
			{"step": 6, "action": "run_capforge", "args": []string{"publish", "--root", ".", "--dist", "dist"}},
		},
	}
	if err := writeJSON(filepath.Join(wellKnown, "bootstrap.json"), bootstrap); err != nil {
		return receipt, err
	}
	if err := writeAgentHTML(distAbs, records, bootstrap); err != nil {
		return receipt, err
	}
	if err := writeInstructionFiles(distAbs, bootstrap); err != nil {
		return receipt, err
	}

	receipt.DecisionCount = len(allDecisions)
	receipt.ImplementationCount = len(implementations)
	receipt.RegistryCount = len(records)
	for _, record := range records {
		receipt.Statuses[record.Status]++
		if record.Status == "active" {
			receipt.ActiveCount++
		}
		if record.Status == "drift" || record.Status == "unobserved" {
			receipt.Status = "FAIL"
			receipt.Errors = append(receipt.Errors, record.ID+": "+strings.Join(record.Issues, "; "))
		}
	}
	receipt.Artifacts["capforge"] = capforgeImpl.PayloadSHA256
	receipt.Artifacts["registry-search"] = searchImpl.PayloadSHA256
	receipt.Artifacts["source-kit"] = kitSHA
	files, err := distHashes(distAbs, "./.well-known/build.json")
	if err != nil {
		return receipt, err
	}
	receipt.DistFiles = files
	if err := writeJSON(filepath.Join(wellKnown, "build.json"), receipt); err != nil {
		return receipt, err
	}
	return receipt, nil
}

func copyPlatformAssets(dist string) error {
	assets := map[string]string{
		"web/index.html":       "index.html",
		"web/app.mjs":          "app.mjs",
		"web/styles.css":       "styles.css",
		"web/_headers":         "_headers",
		"runtime/wasm_exec.js": "assets/wasm_exec.js",
	}
	for src, dst := range assets {
		data, err := asset(src)
		if err != nil {
			return err
		}
		if err := writeFile(filepath.Join(dist, filepath.FromSlash(dst)), data, 0o644); err != nil {
			return err
		}
	}
	return nil
}

func writeAgentHTML(dist string, records []RegistryRecord, bootstrap Bootstrap) error {
	var items strings.Builder
	for _, record := range records {
		if record.Status != "active" || record.Implementation == nil {
			continue
		}
		impl := record.Implementation
		var projections strings.Builder
		if impl.Projection != nil {
			paths := make([]string, 0, len(impl.Projection.Outputs))
			for path := range impl.Projection.Outputs {
				paths = append(paths, path)
			}
			sort.Strings(paths)
			for _, path := range paths {
				fmt.Fprintf(&projections, " · <a href=\"%s\">%s</a>", html.EscapeString(path), html.EscapeString(strings.TrimPrefix(path, "./")))
			}
		}
		fmt.Fprintf(&items, "<li><strong>%s</strong> <code>%s</code> — %s/%s<br><a href=\"%s\">carrier</a> · <code>%s</code>%s</li>\n",
			html.EscapeString(record.Title), html.EscapeString(record.ID), html.EscapeString(impl.Kind), html.EscapeString(impl.Target), html.EscapeString(impl.CarrierPath), html.EscapeString(impl.PayloadSHA256), projections.String())
	}
	doc := fmt.Sprintf(`<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agent Bootstrap</title><link rel="stylesheet" href="./styles.css"></head>
<body><main><header><p class="eyebrow">JavaScript不要</p><h1>Agent / Pro bootstrap</h1><p>公開textだけでplatformとCapabilityを復元します。</p></header>
<section><h2>入口</h2><ul><li><a href="./.well-known/bootstrap.json">bootstrap.json</a></li><li><a href="./.well-known/registry.jsonl">registry.jsonl</a></li><li><a href="./agent-add.txt">agent-add.txt</a></li><li><a href="%s">source kit carrier</a></li></ul></section>
<section><h2>Active Capability</h2><ul>%s</ul></section><p><a href="./">人向け画面</a></p></main></body></html>
`, html.EscapeString(bootstrap.SourceKit.CarrierPath), items.String())
	return writeFile(filepath.Join(dist, "agent.html"), []byte(doc), 0o644)
}

func writeInstructionFiles(dist string, bootstrap Bootstrap) error {
	human := fmt.Sprintf(`# Go-only Pro Capability Platform

このdistだけで、platformを再ビルドせずにCapabilityを追加できます。新規・変更Go Capabilityだけは利用環境のGo toolchainで1回buildし、未変更Capabilityは同梱cacheを再利用します。

1. [bootstrap.json](./.well-known/bootstrap.json)からCapforge carrierとSHA-256を取得する。
2. carrierを標準Base64 decodeし、SHA-256一致後に実行権限を付ける。
3. [source kit](%s)を取得・復元・展開する。既存Capabilityのcontent cacheを含む。
4. 次を実行する。

    capforge add --root . --id <id> --title <title> --purpose <purpose> --message <message>
    capforge publish --root . --dist dist

publishは既定で次の2成果物を生成します。

    <yymmddhhmmss>.%s.bundle
    <yymmddhhmmss>.%s.dist.zip

時刻はJST、IDは固定既定値です。bundleはGit bundle、dist.zipは決定的ZIPです。addは意思決定JSONLと独立Go directoryだけを追加します。Registry、carrier、人向けUI、agent入口は編集しません。変更がないCapabilityは.capforge/cacheを再利用します。

Capabilityが公開data projectionを必要とする場合だけ、同じdirectoryへprojection.jsonを置きます。fixture成功後にbuild済みCapability自身が隔離stageへ投影を生成し、Capforgeは宣言された入力・出力のSHA-256をRegistryへ記録します。inputsへ置いたledger等のappendではpayloadを再buildしません。中央Publisherへdomain固有処理を追加しません。
`, bootstrap.SourceKit.RawPath, DefaultReleaseID, DefaultReleaseID)
	if err := writeFile(filepath.Join(dist, "ADD.md"), []byte(human), 0o644); err != nil {
		return err
	}
	agent := fmt.Sprintf(`schema=capforge-agent-add/1
bootstrap=./.well-known/bootstrap.json
capforge_carrier=%s
capforge_sha256=%s
source_kit_carrier=%s
source_kit_sha256=%s
seed=standard_base64_decode+sha256+chmod+exec
release_id=%s
release_timestamp_format=yymmddhhmmss
release_bundle_pattern=<yymmddhhmmss>.%s.bundle
release_dist_zip_pattern=<yymmddhhmmss>.%s.dist.zip
steps=materialize_capforge;verify_capforge_sha;run_capforge_version;materialize_source_kit;verify_source_kit_sha;unzip_source_kit;run_capforge_add;edit_only_new_capability_if_needed;run_capforge_publish;deploy_dist_zip
invariant=do_not_edit_generated_registry_or_carrier
invariant=do_not_execute_when_sha256_mismatches
requirement=go_toolchain_is_needed_only_for_new_or_changed_go_capability
invariant=unchanged_platform_and_capabilities_must_reuse_cache
optional=projection_json_runs_verified_payload_and_hashes_declared_dist_outputs
invariant=projection_inputs_change_projection_without_rebuilding_payload
`, bootstrap.Capforge.CarrierPath, bootstrap.Capforge.PayloadSHA256, bootstrap.SourceKit.CarrierPath, bootstrap.SourceKit.SHA256, DefaultReleaseID, DefaultReleaseID, DefaultReleaseID)
	return writeFile(filepath.Join(dist, "agent-add.txt"), []byte(agent), 0o644)
}

func distHashes(dist string, exclude string) (map[string]string, error) {
	paths, err := sortedFiles(dist, func(path string, _ os.DirEntry) bool {
		rel, _ := filepath.Rel(dist, path)
		return "./"+filepath.ToSlash(rel) != exclude
	})
	if err != nil {
		return nil, err
	}
	result := map[string]string{}
	for _, path := range paths {
		rel, _ := filepath.Rel(dist, path)
		sha, _, err := fileSHA(path)
		if err != nil {
			return nil, err
		}
		result[filepath.ToSlash(rel)] = sha
	}
	return result, nil
}
