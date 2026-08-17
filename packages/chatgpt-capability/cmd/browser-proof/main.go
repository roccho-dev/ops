package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type receipt struct {
	Schema      string `json:"schema"`
	Status      string `json:"status"`
	Chromium    string `json:"chromium"`
	Mode        string `json:"mode"`
	ProofStatus string `json:"proofStatus"`
	Active      string `json:"active"`
	SearchSHA   string `json:"searchSha256"`
	Screenshot  string `json:"screenshot,omitempty"`
	ElapsedMS   int64  `json:"elapsedMs"`
	Error       string `json:"error,omitempty"`
}

type cdpClient struct {
	conn net.Conn
	rw   *bufio.ReadWriter
	next int
}

func main() {
	dist := flag.String("dist", "dist", "dist directory")
	out := flag.String("out", "build/browser-proof.json", "receipt path")
	screenshot := flag.String("screenshot", "build/browser-proof.png", "screenshot path")
	flag.Parse()
	started := time.Now()
	r := receipt{Schema: "capforge-browser-proof/1", Status: "FAIL", Chromium: findChromium(), Mode: "CDP actual-index exact-resource injection"}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	userData, err := os.MkdirTemp("", "capforge-chromium-*")
	if err != nil {
		fail(&r, err, *out)
	}
	defer os.RemoveAll(userData)
	chrome := exec.CommandContext(ctx, r.Chromium,
		"--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
		"--disable-background-networking", "--no-first-run", "--remote-debugging-port=0",
		"--user-data-dir="+userData, "about:blank",
	)
	var chromeLog bytes.Buffer
	chrome.Stdout = &chromeLog
	chrome.Stderr = &chromeLog
	if err := chrome.Start(); err != nil {
		fail(&r, err, *out)
	}
	defer func() {
		if chrome.Process != nil {
			_ = chrome.Process.Kill()
		}
	}()

	port, err := waitDevToolsPort(ctx, filepath.Join(userData, "DevToolsActivePort"))
	if err != nil {
		fail(&r, fmt.Errorf("devtools port: %w; chrome=%s", err, chromeLog.String()), *out)
	}
	wsURL, err := pageWebSocket(ctx, port)
	if err != nil {
		fail(&r, err, *out)
	}
	client, err := dialWebSocket(wsURL)
	if err != nil {
		fail(&r, err, *out)
	}
	defer client.conn.Close()

	if _, err := client.call(ctx, "Page.enable", map[string]any{}); err != nil {
		fail(&r, err, *out)
	}
	if _, err := client.call(ctx, "Runtime.enable", map[string]any{}); err != nil {
		fail(&r, err, *out)
	}
	frameResult, err := client.call(ctx, "Page.getFrameTree", map[string]any{})
	if err != nil {
		fail(&r, err, *out)
	}
	frameID, err := nestedString(frameResult, "result", "frameTree", "frame", "id")
	if err != nil {
		fail(&r, err, *out)
	}
	html, err := proofHTML(*dist)
	if err != nil {
		fail(&r, err, *out)
	}
	if _, err := client.call(ctx, "Page.setDocumentContent", map[string]any{"frameId": frameID, "html": html}); err != nil {
		fail(&r, err, *out)
	}

	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		value, err := client.evaluate(ctx, `JSON.stringify({status:document.body.dataset.proofStatus,active:(document.querySelector('#summary')||{}).textContent||'',proof:(document.querySelector('#proof')||{}).textContent||''})`)
		if err == nil && value != "" {
			var state struct {
				Status string `json:"status"`
				Active string `json:"active"`
				Proof  string `json:"proof"`
			}
			if json.Unmarshal([]byte(value), &state) == nil {
				r.ProofStatus = state.Status
				r.Active = state.Active
				if state.Status == "PASS" {
					var proof map[string]any
					_ = json.Unmarshal([]byte(state.Proof), &proof)
					if search, ok := proof["search"].(string); ok {
						r.SearchSHA = search
					}
					r.Status = "PASS"
					break
				}
				if state.Status == "FAIL" {
					r.Error = state.Proof
					break
				}
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	if r.Status == "PASS" {
		shot, err := client.call(ctx, "Page.captureScreenshot", map[string]any{"format": "png", "captureBeyondViewport": true})
		if err == nil {
			encoded, _ := nestedString(shot, "result", "data")
			if data, decodeErr := base64.StdEncoding.DecodeString(encoded); decodeErr == nil {
				_ = os.MkdirAll(filepath.Dir(*screenshot), 0o755)
				if os.WriteFile(*screenshot, data, 0o644) == nil {
					r.Screenshot = filepath.ToSlash(*screenshot)
				}
			}
		}
	} else if r.Error == "" {
		r.Error = "browser proof did not reach PASS"
	}
	r.ElapsedMS = time.Since(started).Milliseconds()
	finish(r, *out)
	if r.Status != "PASS" {
		os.Exit(1)
	}
}

func proofHTML(dist string) (string, error) {
	files := map[string]string{
		".well-known/bootstrap.json": "application/json",
		".well-known/registry.jsonl": "text/plain",
	}
	resources := map[string]map[string]string{}
	for rel, mime := range files {
		data, err := os.ReadFile(filepath.Join(dist, filepath.FromSlash(rel)))
		if err != nil {
			return "", err
		}
		resources[rel] = map[string]string{"mime": mime, "base64": base64.StdEncoding.EncodeToString(data)}
	}
	bootstrapData, err := os.ReadFile(filepath.Join(dist, ".well-known", "bootstrap.json"))
	if err != nil {
		return "", err
	}
	var bootstrap struct {
		Search struct {
			RawPath string `json:"rawPath"`
		} `json:"search"`
	}
	if err := json.Unmarshal(bootstrapData, &bootstrap); err != nil {
		return "", err
	}
	searchRel := strings.TrimPrefix(bootstrap.Search.RawPath, "./")
	searchData, err := os.ReadFile(filepath.Join(dist, filepath.FromSlash(searchRel)))
	if err != nil {
		return "", err
	}
	resources[searchRel] = map[string]string{"mime": "application/wasm", "base64": base64.StdEncoding.EncodeToString(searchData)}
	resourceJSON, _ := json.Marshal(resources)

	indexData, err := os.ReadFile(filepath.Join(dist, "index.html"))
	if err != nil {
		return "", err
	}
	styles, err := os.ReadFile(filepath.Join(dist, "styles.css"))
	if err != nil {
		return "", err
	}
	wasmExec, err := os.ReadFile(filepath.Join(dist, "assets", "wasm_exec.js"))
	if err != nil {
		return "", err
	}
	app, err := os.ReadFile(filepath.Join(dist, "app.mjs"))
	if err != nil {
		return "", err
	}

	html := string(indexData)
	html = strings.Replace(html, `<link rel="stylesheet" href="./styles.css">`, `<style>`+string(styles)+`</style>`, 1)
	boot := `<script>
const __resources = ` + string(resourceJSON) + `;
const __decode = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const __key = input => {
  let value = typeof input === 'string' ? input : input.url;
  value = value.split('?')[0].replace(/^https?:\/\/[^/]+\//, '').replace(/^\.\//, '').replace(/^\//, '');
  return value;
};
globalThis.fetch = async input => {
  const key = __key(input);
  const resource = __resources[key];
  if (!resource) return new Response('', {status:404});
  return new Response(__decode(resource.base64), {status:200, headers:{'Content-Type':resource.mime}});
};
(0, eval)(new TextDecoder().decode(__decode('` + base64.StdEncoding.EncodeToString(wasmExec) + `')));
const __appURL = URL.createObjectURL(new Blob([__decode('` + base64.StdEncoding.EncodeToString(app) + `')], {type:'text/javascript'}));
import(__appURL);
</script>`
	html = strings.Replace(html, `<script src="./assets/wasm_exec.js"></script>
  <script type="module" src="./app.mjs"></script>`, boot, 1)
	if strings.Contains(html, `src="./app.mjs"`) || strings.Contains(html, `href="./styles.css"`) {
		return "", errors.New("proof HTML did not replace actual dist resources")
	}
	return html, nil
}

func waitDevToolsPort(ctx context.Context, path string) (string, error) {
	for {
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		default:
		}
		data, err := os.ReadFile(path)
		if err == nil {
			lines := strings.Split(strings.TrimSpace(string(data)), "\n")
			if len(lines) > 0 && lines[0] != "" {
				return lines[0], nil
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func pageWebSocket(ctx context.Context, port string) (string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://127.0.0.1:"+port+"/json/list", nil)
	if err != nil {
		return "", err
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	var targets []struct {
		Type string `json:"type"`
		WS   string `json:"webSocketDebuggerUrl"`
	}
	if err := json.NewDecoder(response.Body).Decode(&targets); err != nil {
		return "", err
	}
	for _, target := range targets {
		if target.Type == "page" && target.WS != "" {
			return target.WS, nil
		}
	}
	return "", errors.New("no page target")
}

func dialWebSocket(rawURL string) (*cdpClient, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}
	conn, err := net.DialTimeout("tcp", u.Host, 5*time.Second)
	if err != nil {
		return nil, err
	}
	keyBytes := make([]byte, 16)
	_, _ = rand.Read(keyBytes)
	key := base64.StdEncoding.EncodeToString(keyBytes)
	path := u.RequestURI()
	request := fmt.Sprintf("GET %s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n", path, u.Host, key)
	rw := bufio.NewReadWriter(bufio.NewReader(conn), bufio.NewWriter(conn))
	if _, err := rw.WriteString(request); err != nil {
		conn.Close()
		return nil, err
	}
	if err := rw.Flush(); err != nil {
		conn.Close()
		return nil, err
	}
	status, err := rw.ReadString('\n')
	if err != nil || !strings.Contains(status, "101") {
		conn.Close()
		return nil, fmt.Errorf("websocket handshake failed: %s %v", strings.TrimSpace(status), err)
	}
	headers := map[string]string{}
	for {
		line, err := rw.ReadString('\n')
		if err != nil {
			conn.Close()
			return nil, err
		}
		line = strings.TrimSpace(line)
		if line == "" {
			break
		}
		parts := strings.SplitN(line, ":", 2)
		if len(parts) == 2 {
			headers[strings.ToLower(strings.TrimSpace(parts[0]))] = strings.TrimSpace(parts[1])
		}
	}
	expected := sha1.Sum([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	if headers["sec-websocket-accept"] != base64.StdEncoding.EncodeToString(expected[:]) {
		conn.Close()
		return nil, errors.New("invalid websocket accept")
	}
	return &cdpClient{conn: conn, rw: rw}, nil
}

func (client *cdpClient) call(ctx context.Context, method string, params map[string]any) (map[string]any, error) {
	client.next++
	id := client.next
	message, _ := json.Marshal(map[string]any{"id": id, "method": method, "params": params})
	if err := client.writeFrame(message); err != nil {
		return nil, err
	}
	for {
		if deadline, ok := ctx.Deadline(); ok {
			_ = client.conn.SetReadDeadline(deadline)
		}
		payload, err := client.readMessage()
		if err != nil {
			return nil, err
		}
		var response map[string]any
		if json.Unmarshal(payload, &response) != nil {
			continue
		}
		if responseID, ok := response["id"].(float64); ok && int(responseID) == id {
			if protocolError, exists := response["error"]; exists {
				return nil, fmt.Errorf("CDP %s: %v", method, protocolError)
			}
			return response, nil
		}
	}
}

func (client *cdpClient) evaluate(ctx context.Context, expression string) (string, error) {
	response, err := client.call(ctx, "Runtime.evaluate", map[string]any{"expression": expression, "returnByValue": true})
	if err != nil {
		return "", err
	}
	value, err := nested(response, "result", "result", "value")
	if err != nil {
		return "", err
	}
	return fmt.Sprint(value), nil
}

func (client *cdpClient) writeFrame(payload []byte) error {
	var header bytes.Buffer
	header.WriteByte(0x81)
	length := len(payload)
	switch {
	case length < 126:
		header.WriteByte(byte(length) | 0x80)
	case length <= 65535:
		header.WriteByte(126 | 0x80)
		_ = binary.Write(&header, binary.BigEndian, uint16(length))
	default:
		header.WriteByte(127 | 0x80)
		_ = binary.Write(&header, binary.BigEndian, uint64(length))
	}
	mask := make([]byte, 4)
	_, _ = rand.Read(mask)
	header.Write(mask)
	masked := make([]byte, len(payload))
	for i := range payload {
		masked[i] = payload[i] ^ mask[i%4]
	}
	if _, err := client.rw.Write(header.Bytes()); err != nil {
		return err
	}
	if _, err := client.rw.Write(masked); err != nil {
		return err
	}
	return client.rw.Flush()
}

func (client *cdpClient) readMessage() ([]byte, error) {
	var aggregate []byte
	for {
		first, err := client.rw.ReadByte()
		if err != nil {
			return nil, err
		}
		second, err := client.rw.ReadByte()
		if err != nil {
			return nil, err
		}
		fin := first&0x80 != 0
		opcode := first & 0x0f
		masked := second&0x80 != 0
		length := uint64(second & 0x7f)
		switch length {
		case 126:
			var value uint16
			if err := binary.Read(client.rw, binary.BigEndian, &value); err != nil {
				return nil, err
			}
			length = uint64(value)
		case 127:
			if err := binary.Read(client.rw, binary.BigEndian, &length); err != nil {
				return nil, err
			}
		}
		var mask []byte
		if masked {
			mask = make([]byte, 4)
			if _, err := io.ReadFull(client.rw, mask); err != nil {
				return nil, err
			}
		}
		payload := make([]byte, length)
		if _, err := io.ReadFull(client.rw, payload); err != nil {
			return nil, err
		}
		if masked {
			for i := range payload {
				payload[i] ^= mask[i%4]
			}
		}
		switch opcode {
		case 0x8:
			return nil, io.EOF
		case 0x9:
			_ = client.writeControl(0xA, payload)
			continue
		case 0xA:
			continue
		case 0x0, 0x1:
			aggregate = append(aggregate, payload...)
			if fin {
				return aggregate, nil
			}
		default:
			if fin && len(aggregate) > 0 {
				return aggregate, nil
			}
		}
	}
}

func (client *cdpClient) writeControl(opcode byte, payload []byte) error {
	if len(payload) > 125 {
		payload = payload[:125]
	}
	frame := []byte{0x80 | opcode, 0x80 | byte(len(payload))}
	mask := make([]byte, 4)
	_, _ = rand.Read(mask)
	frame = append(frame, mask...)
	for i := range payload {
		frame = append(frame, payload[i]^mask[i%4])
	}
	if _, err := client.rw.Write(frame); err != nil {
		return err
	}
	return client.rw.Flush()
}

func nestedString(value map[string]any, keys ...string) (string, error) {
	item, err := nested(value, keys...)
	if err != nil {
		return "", err
	}
	text, ok := item.(string)
	if !ok {
		return "", fmt.Errorf("not string at %s", strings.Join(keys, "."))
	}
	return text, nil
}

func nested(value map[string]any, keys ...string) (any, error) {
	var current any = value
	for _, key := range keys {
		object, ok := current.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("not object before %s", key)
		}
		current, ok = object[key]
		if !ok {
			return nil, fmt.Errorf("missing %s", key)
		}
	}
	return current, nil
}

func findChromium() string {
	for _, name := range []string{"chromium", "chromium-browser", "google-chrome"} {
		if path, err := exec.LookPath(name); err == nil {
			return path
		}
	}
	return "chromium"
}

func fail(r *receipt, err error, path string) {
	r.Error = err.Error()
	finish(*r, path)
	os.Exit(1)
}

func finish(r receipt, path string) {
	data, _ := json.MarshalIndent(r, "", "  ")
	data = append(data, '\n')
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	_ = os.WriteFile(path, data, 0o644)
	fmt.Print(string(data))
}

func atoi(value string) int {
	n, _ := strconv.Atoi(value)
	return n
}
