// Keep this file in sync with nemo/parts/local/cdp-bridge.zig
// (duplicated because flakes-local uses multiple worktrees).

const std = @import("std");

const WsUrl = struct {
    host: []const u8,
    port: u16,
    path: []const u8,
};

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const argv = try std.process.argsAlloc(allocator);
    defer std.process.argsFree(allocator, argv);

    if (argv.len < 2) {
        try usage();
        return;
    }

    const cmd = argv[1];
    if (std.mem.eql(u8, cmd, "version")) {
        const opts = try parseAddrPort(argv, 2);
        const body = try httpRequest(allocator, opts.addr, opts.port, "GET", "/json/version");
        defer allocator.free(body);
        try writeJsonOrString(body);
        return;
    }

    if (std.mem.eql(u8, cmd, "wsurl")) {
        const opts = try parseAddrPort(argv, 2);
        const body = try httpRequest(allocator, opts.addr, opts.port, "GET", "/json/version");
        defer allocator.free(body);
        const ws = try extractJsonStringField(allocator, body, "webSocketDebuggerUrl");
        defer allocator.free(ws);
        const out = std.fs.File.stdout().deprecatedWriter();
        try out.print("{s}\n", .{ws});
        return;
    }

    if (std.mem.eql(u8, cmd, "list")) {
        const opts = try parseAddrPort(argv, 2);
        const body = try httpRequest(allocator, opts.addr, opts.port, "GET", "/json/list");
        defer allocator.free(body);
        try writeJsonOrString(body);
        return;
    }

    if (std.mem.eql(u8, cmd, "new")) {
        const opts = try parseAddrPort(argv, 2);
        const url = try parseFlagValue(argv, 2, "--url") orelse "about:blank";
        const path = try buildNewPath(allocator, url);
        defer allocator.free(path);
        const body = try httpRequest(allocator, opts.addr, opts.port, "PUT", path);
        defer allocator.free(body);
        try writeJsonOrString(body);
        return;
    }

    if (std.mem.eql(u8, cmd, "close")) {
        const opts = try parseAddrPort(argv, 2);
        const id = try parseFlagValue(argv, 2, "--id") orelse {
            try die("missing: --id");
            return;
        };
        const path = try std.fmt.allocPrint(allocator, "/json/close/{s}", .{id});
        defer allocator.free(path);
        const body = try httpRequest(allocator, opts.addr, opts.port, "PUT", path);
        defer allocator.free(body);
        try writeJsonOrString(body);
        return;
    }

    if (std.mem.eql(u8, cmd, "call")) {
        const ws_url = try parseFlagValue(argv, 2, "--ws") orelse {
            try die("missing: --ws");
            return;
        };
        const req = try parseFlagValue(argv, 2, "--req") orelse {
            try die("missing: --req");
            return;
        };

        const timeout_ms_str = try parseFlagValue(argv, 2, "--timeout-ms") orelse "30000";
        const timeout_ms = std.fmt.parseUnsigned(u32, timeout_ms_str, 10) catch 30000;

        const resp = try wsCall(allocator, ws_url, req, timeout_ms);
        defer allocator.free(resp);
        const out = std.fs.File.stdout().deprecatedWriter();
        try out.print("{s}\n", .{resp});
        return;
    }

    if (std.mem.eql(u8, cmd, "filechooser")) {
        const ws_url = try parseFlagValue(argv, 2, "--ws") orelse {
            try die("missing: --ws");
            return;
        };
        const selector = try parseFlagValue(argv, 2, "--selector") orelse {
            try die("missing: --selector");
            return;
        };
        const file_path = try parseFlagValue(argv, 2, "--file") orelse {
            try die("missing: --file");
            return;
        };

        const timeout_ms_str = try parseFlagValue(argv, 2, "--timeout-ms") orelse "30000";
        const timeout_ms = std.fmt.parseUnsigned(u32, timeout_ms_str, 10) catch 30000;

        const resp = try wsFileChooser(allocator, ws_url, selector, file_path, timeout_ms);
        defer allocator.free(resp);
        const out = std.fs.File.stdout().deprecatedWriter();
        try out.print("{s}\n", .{resp});
        return;
    }

    try usage();
}

fn usage() !void {
    const w = std.fs.File.stderr().deprecatedWriter();
    try w.writeAll(
        "cdp-bridge: minimal CDP helper (HTTP + WebSocket)\n\n" ++
            "usage:\n" ++
            "  cdp-bridge version [--addr 127.0.0.1] [--port 9222]\n" ++
            "  cdp-bridge wsurl   [--addr 127.0.0.1] [--port 9222]\n" ++
            "  cdp-bridge list    [--addr 127.0.0.1] [--port 9222]\n" ++
            "  cdp-bridge new     [--addr 127.0.0.1] [--port 9222] [--url about:blank]\n" ++
            "  cdp-bridge close   [--addr 127.0.0.1] [--port 9222] --id <targetId>\n" ++
            "  cdp-bridge call    --ws <ws://...> --req <json> [--timeout-ms 30000]\n" ++
            "  cdp-bridge filechooser --ws <ws://...> --selector <css> --file <path> [--timeout-ms 30000]\n",
    );
}

fn die(msg: []const u8) !void {
    const w = std.fs.File.stderr().deprecatedWriter();
    try w.print("{s}\n", .{msg});
    try usage();
    std.process.exit(2);
}

const AddrPort = struct {
    addr: []const u8,
    port: u16,
};

fn parseAddrPort(argv: []const []const u8, start: usize) !AddrPort {
    var addr: []const u8 = "127.0.0.1";
    var port: u16 = 9222;

    var i: usize = start;
    while (i < argv.len) : (i += 1) {
        const a = argv[i];
        if (std.mem.eql(u8, a, "--addr")) {
            if (i + 1 >= argv.len) try die("missing value for --addr");
            addr = argv[i + 1];
            i += 1;
        } else if (std.mem.eql(u8, a, "--port")) {
            if (i + 1 >= argv.len) try die("missing value for --port");
            port = std.fmt.parseUnsigned(u16, argv[i + 1], 10) catch port;
            i += 1;
        }
    }

    return .{ .addr = addr, .port = port };
}

fn parseFlagValue(argv: []const []const u8, start: usize, flag: []const u8) !?[]const u8 {
    var i: usize = start;
    while (i < argv.len) : (i += 1) {
        if (std.mem.eql(u8, argv[i], flag)) {
            if (i + 1 >= argv.len) return null;
            return argv[i + 1];
        }
    }
    return null;
}

fn buildNewPath(allocator: std.mem.Allocator, url: []const u8) ![]u8 {
    // /json/new?<url>
    // The request target cannot contain spaces; encode them minimally.
    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(allocator);

    try out.appendSlice(allocator, "/json/new?");
    for (url) |c| {
        if (c == ' ') {
            try out.appendSlice(allocator, "%20");
        } else if (c == '\r' or c == '\n') {
            // strip
        } else {
            try out.append(allocator, c);
        }
    }
    return out.toOwnedSlice(allocator);
}

fn httpRequest(allocator: std.mem.Allocator, addr: []const u8, port: u16, method: []const u8, path: []const u8) ![]u8 {
    var bs = BufferedStream{ .stream = try std.net.tcpConnectToHost(allocator, addr, port) };
    defer bs.stream.close();

    const req = try std.fmt.allocPrint(
        allocator,
        "{s} {s} HTTP/1.1\r\nHost: {s}:{d}\r\nConnection: close\r\n\r\n",
        .{ method, path, addr, port },
    );
    defer allocator.free(req);
    try bs.stream.writeAll(req);

    // Don't hang forever on a keep-alive socket.
    try setRecvTimeout(bs.stream, 30000);

    const hdr_bytes = try bs.readHeaders(allocator, 64 * 1024);
    defer allocator.free(hdr_bytes);

    const cl = findHeaderValue(hdr_bytes, "content-length") orelse return error.InvalidHttpResponse;
    const content_len = std.fmt.parseUnsigned(usize, cl, 10) catch return error.InvalidHttpResponse;
    if (content_len > 8 * 1024 * 1024) return error.StreamTooLong;

    const body = try allocator.alloc(u8, content_len);
    errdefer allocator.free(body);
    try bs.readExact(body);
    return body;
}

fn looksLikeJson(body: []const u8) bool {
    const trimmed = std.mem.trim(u8, body, " \t\r\n");
    if (trimmed.len == 0) return false;
    return trimmed[0] == '{' or trimmed[0] == '[';
}

fn writeJsonOrString(body: []const u8) !void {
    const out = std.fs.File.stdout().deprecatedWriter();
    if (looksLikeJson(body)) {
        try out.print("{s}\n", .{body});
        return;
    }

    try writeJsonString(out, std.mem.trim(u8, body, "\r\n"));
    try out.writeByte('\n');
}

fn writeJsonString(out: anytype, s: []const u8) !void {
    try out.writeByte('"');
    for (s) |c| {
        switch (c) {
            '"' => try out.writeAll("\\\""),
            '\\' => try out.writeAll("\\\\"),
            '\n' => try out.writeAll("\\n"),
            '\r' => try out.writeAll("\\r"),
            '\t' => try out.writeAll("\\t"),
            else => {
                if (c < 0x20) {
                    try out.print("\\u00{X:0>2}", .{c});
                } else {
                    try out.writeByte(c);
                }
            },
        }
    }
    try out.writeByte('"');
}

fn extractJsonStringField(allocator: std.mem.Allocator, body: []const u8, field: []const u8) ![]u8 {
    var parsed = try std.json.parseFromSlice(std.json.Value, allocator, body, .{});
    defer parsed.deinit();

    const root = parsed.value;
    if (root != .object) return error.InvalidJson;
    const v = root.object.get(field) orelse return error.MissingField;
    if (v != .string) return error.InvalidFieldType;
    return allocator.dupe(u8, v.string);
}

fn parseWsUrl(url: []const u8) !WsUrl {
    const scheme = "ws://";
    if (!std.mem.startsWith(u8, url, scheme)) return error.InvalidWsUrl;

    var rest = url[scheme.len..];
    var path: []const u8 = "/";
    if (std.mem.indexOfScalar(u8, rest, '/')) |slash| {
        path = rest[slash..];
        rest = rest[0..slash];
    }

    var host: []const u8 = rest;
    var port: u16 = 80;

    if (std.mem.startsWith(u8, host, "[")) {
        // IPv6 literal: [::1]:9222
        const end = std.mem.indexOfScalar(u8, host, ']') orelse return error.InvalidWsUrl;
        const host_part = host[1..end];
        host = host_part;
        if (end + 1 < rest.len and rest[end + 1] == ':') {
            port = std.fmt.parseUnsigned(u16, rest[(end + 2)..], 10) catch return error.InvalidWsUrl;
        }
    } else if (std.mem.lastIndexOfScalar(u8, host, ':')) |colon| {
        const host_part = host[0..colon];
        const port_part = host[(colon + 1)..];
        if (host_part.len != 0 and port_part.len != 0) {
            host = host_part;
            port = std.fmt.parseUnsigned(u16, port_part, 10) catch return error.InvalidWsUrl;
        }
    }

    if (host.len == 0) return error.InvalidWsUrl;
    if (path.len == 0) path = "/";

    return .{ .host = host, .port = port, .path = path };
}

const BufferedStream = struct {
    stream: std.net.Stream,
    buf: [64 * 1024]u8 = undefined,
    start: usize = 0,
    end: usize = 0,

    fn buffered(self: *const BufferedStream) []const u8 {
        return self.buf[self.start..self.end];
    }

    fn fill(self: *BufferedStream) !void {
        if (self.start > 0 and self.start == self.end) {
            self.start = 0;
            self.end = 0;
        }

        if (self.end == self.buf.len) {
            if (self.start == 0) return error.StreamTooLong;
            const len = self.end - self.start;
            std.mem.copyForwards(u8, self.buf[0..len], self.buf[self.start..self.end]);
            self.start = 0;
            self.end = len;
        }

        const n = try self.stream.read(self.buf[self.end..]);
        if (n == 0) return error.EndOfStream;
        self.end += n;
    }

    fn readHeaders(self: *BufferedStream, allocator: std.mem.Allocator, max_bytes: usize) ![]u8 {
        while (true) {
            if (std.mem.indexOf(u8, self.buffered(), "\r\n\r\n")) |idx| {
                const end_idx = self.start + idx + 4;
                const headers = try allocator.dupe(u8, self.buf[self.start..end_idx]);
                self.start = end_idx;
                return headers;
            }
            if (self.end - self.start >= max_bytes) return error.StreamTooLong;
            try self.fill();
        }
    }

    fn readExact(self: *BufferedStream, out: []u8) !void {
        var off: usize = 0;
        while (off < out.len) {
            if (self.start < self.end) {
                const avail = self.end - self.start;
                const n = @min(avail, out.len - off);
                std.mem.copyForwards(u8, out[off .. off + n], self.buf[self.start .. self.start + n]);
                self.start += n;
                off += n;
                continue;
            }

            const nread = try self.stream.read(out[off..]);
            if (nread == 0) return error.EndOfStream;
            off += nread;
        }
    }
};

fn wsCall(allocator: std.mem.Allocator, ws_url: []const u8, req_json: []const u8, timeout_ms: u32) ![]u8 {
    const parsed_ws = try parseWsUrl(ws_url);

    // Parse request id so we can ignore CDP events.
    var req_parsed = try std.json.parseFromSlice(std.json.Value, allocator, req_json, .{});
    defer req_parsed.deinit();
    if (req_parsed.value != .object) return error.InvalidJson;
    const idv = req_parsed.value.object.get("id") orelse return error.MissingField;
    if (idv != .integer) return error.InvalidFieldType;
    const req_id: i64 = idv.integer;

    var bs = BufferedStream{ .stream = try std.net.tcpConnectToHost(allocator, parsed_ws.host, parsed_ws.port) };
    defer bs.stream.close();

    if (timeout_ms > 0) {
        try setRecvTimeout(bs.stream, timeout_ms);
    }

    const sec_key = try genSecWebSocketKey(allocator);
    defer allocator.free(sec_key);
    const accept_expected = try computeSecWebSocketAccept(allocator, sec_key);
    defer allocator.free(accept_expected);

    try wsHandshake(allocator, &bs, parsed_ws.host, parsed_ws.port, parsed_ws.path, sec_key, accept_expected);
    try wsSendText(bs.stream, req_json);

    while (true) {
        const msg = try wsReadTextMessage(allocator, &bs);
        errdefer allocator.free(msg);

        // Parse top-level id and compare.
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, msg, .{}) catch {
            allocator.free(msg);
            continue;
        };
        defer parsed.deinit();

        if (parsed.value == .object) {
            if (parsed.value.object.get("id")) |rid| {
                if (rid == .integer and rid.integer == req_id) {
                    return msg;
                }
            }
        }

        allocator.free(msg);
    }
}

fn wsFileChooser(
    allocator: std.mem.Allocator,
    ws_url: []const u8,
    selector: []const u8,
    file_path: []const u8,
    timeout_ms: u32,
) ![]u8 {
    const parsed_ws = try parseWsUrl(ws_url);

    var bs = BufferedStream{ .stream = try std.net.tcpConnectToHost(allocator, parsed_ws.host, parsed_ws.port) };
    defer bs.stream.close();

    if (timeout_ms > 0) {
        try setRecvTimeout(bs.stream, timeout_ms);
    }

    const sec_key = try genSecWebSocketKey(allocator);
    defer allocator.free(sec_key);
    const accept_expected = try computeSecWebSocketAccept(allocator, sec_key);
    defer allocator.free(accept_expected);
    try wsHandshake(allocator, &bs, parsed_ws.host, parsed_ws.port, parsed_ws.path, sec_key, accept_expected);

    var next_id: i64 = 1;

    const resp_runtime_enable = try wsSendAndWaitId(allocator, &bs, try buildReqNoParams(allocator, next_id, "Runtime.enable"), next_id);
    defer allocator.free(resp_runtime_enable);
    next_id += 1;

    const resp_dom_enable = try wsSendAndWaitId(allocator, &bs, try buildReqNoParams(allocator, next_id, "DOM.enable"), next_id);
    defer allocator.free(resp_dom_enable);
    next_id += 1;

    const resp_page_enable = try wsSendAndWaitId(allocator, &bs, try buildReqNoParams(allocator, next_id, "Page.enable"), next_id);
    defer allocator.free(resp_page_enable);
    next_id += 1;

    const resp_bring = try wsSendAndWaitId(allocator, &bs, try buildReqNoParams(allocator, next_id, "Page.bringToFront"), next_id);
    defer allocator.free(resp_bring);
    next_id += 1;

    const resp_intercept_on = try wsSendAndWaitId(
        allocator,
        &bs,
        try buildReqInterceptFileChooser(allocator, next_id, true, null),
        next_id,
    );
    defer allocator.free(resp_intercept_on);
    next_id += 1;

    const center_expr = try buildCenterExpr(allocator, selector);
    defer allocator.free(center_expr);
    const resp_center = try wsSendAndWaitId(
        allocator,
        &bs,
        try buildReqRuntimeEvaluate(allocator, next_id, center_expr, true, false, false),
        next_id,
    );
    defer allocator.free(resp_center);
    next_id += 1;

    const click_expr = try buildClickExpr(allocator, selector);
    defer allocator.free(click_expr);
    const click_req = try buildReqRuntimeEvaluate(allocator, next_id, click_expr, true, false, true);
    defer allocator.free(click_req);
    try wsSendText(bs.stream, click_req);
    const resp_programmatic_click = try std.fmt.allocPrint(allocator, "{{\"id\":{d},\"sent\":true}}", .{next_id});
    defer allocator.free(resp_programmatic_click);
    next_id += 1;

    const evt = try wsWaitForMethod(allocator, &bs, "Page.fileChooserOpened");
    defer allocator.free(evt);
    const backend_node_id = try extractBackendNodeId(allocator, evt);

    const resp_set_files = try wsSendAndWaitId(
        allocator,
        &bs,
        try buildReqSetFileInputFiles(allocator, next_id, backend_node_id, file_path),
        next_id,
    );
    defer allocator.free(resp_set_files);
    next_id += 1;

    const resp_intercept_off = try wsSendAndWaitId(
        allocator,
        &bs,
        try buildReqInterceptFileChooser(allocator, next_id, false, null),
        next_id,
    );
    defer allocator.free(resp_intercept_off);
    next_id += 1;

    const verify_expr = try buildVerifyExpr(allocator, file_path);
    defer allocator.free(verify_expr);
    const resp_verify = try wsSendAndWaitId(
        allocator,
        &bs,
        try buildReqRuntimeEvaluate(allocator, next_id, verify_expr, true, false, false),
        next_id,
    );
    defer allocator.free(resp_verify);

    return std.fmt.allocPrint(
        allocator,
        "{{\"ok\":true,\"backendNodeId\":{d},\"runtime_enable\":{s},\"dom_enable\":{s},\"page_enable\":{s},\"bring_to_front\":{s},\"intercept_on\":{s},\"center\":{s},\"programmatic_click\":{s},\"fileChooserOpened\":{s},\"setFileInputFiles\":{s},\"intercept_off\":{s},\"verify\":{s}}}",
        .{ backend_node_id, resp_runtime_enable, resp_dom_enable, resp_page_enable, resp_bring, resp_intercept_on, resp_center, resp_programmatic_click, evt, resp_set_files, resp_intercept_off, resp_verify },
    );
}

fn wsSendAndWaitId(allocator: std.mem.Allocator, bs: *BufferedStream, req_json: []const u8, req_id: i64) ![]u8 {
    defer allocator.free(req_json);
    try wsSendText(bs.stream, req_json);

    while (true) {
        const msg = try wsReadTextMessage(allocator, bs);
        errdefer allocator.free(msg);

        var parsed = std.json.parseFromSlice(std.json.Value, allocator, msg, .{}) catch {
            allocator.free(msg);
            continue;
        };
        defer parsed.deinit();

        if (parsed.value != .object) {
            allocator.free(msg);
            continue;
        }
        if (parsed.value.object.get("id")) |rid| {
            if (rid == .integer and rid.integer == req_id) {
                return msg;
            }
        }

        allocator.free(msg);
    }
}

fn wsWaitForMethod(allocator: std.mem.Allocator, bs: *BufferedStream, method: []const u8) ![]u8 {
    while (true) {
        const msg = try wsReadTextMessage(allocator, bs);
        errdefer allocator.free(msg);

        var parsed = std.json.parseFromSlice(std.json.Value, allocator, msg, .{}) catch {
            allocator.free(msg);
            continue;
        };
        defer parsed.deinit();
        if (parsed.value != .object) {
            allocator.free(msg);
            continue;
        }

        if (parsed.value.object.get("method")) |mv| {
            if (mv == .string and std.mem.eql(u8, mv.string, method)) {
                return msg;
            }
        }

        allocator.free(msg);
    }
}

fn extractBackendNodeId(allocator: std.mem.Allocator, msg: []const u8) !i64 {
    var parsed = try std.json.parseFromSlice(std.json.Value, allocator, msg, .{});
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidJson;
    const params = parsed.value.object.get("params") orelse return error.MissingField;
    if (params != .object) return error.InvalidFieldType;
    const bn = params.object.get("backendNodeId") orelse return error.MissingField;
    if (bn != .integer) return error.InvalidFieldType;
    return bn.integer;
}

fn buildReqNoParams(allocator: std.mem.Allocator, id: i64, method: []const u8) ![]u8 {
    const method_json = try jsonStringAlloc(allocator, method);
    defer allocator.free(method_json);
    return std.fmt.allocPrint(allocator, "{{\"id\":{d},\"method\":{s},\"params\":{{}}}}", .{ id, method_json });
}

fn buildReqInterceptFileChooser(allocator: std.mem.Allocator, id: i64, enabled: bool, cancel: ?bool) ![]u8 {
    const method_json = try jsonStringAlloc(allocator, "Page.setInterceptFileChooserDialog");
    defer allocator.free(method_json);

    if (cancel) |c| {
        return std.fmt.allocPrint(
            allocator,
            "{{\"id\":{d},\"method\":{s},\"params\":{{\"enabled\":{s},\"cancel\":{s}}}}}",
            .{ id, method_json, if (enabled) "true" else "false", if (c) "true" else "false" },
        );
    }

    return std.fmt.allocPrint(
        allocator,
        "{{\"id\":{d},\"method\":{s},\"params\":{{\"enabled\":{s}}}}}",
        .{ id, method_json, if (enabled) "true" else "false" },
    );
}

fn buildReqRuntimeEvaluate(
    allocator: std.mem.Allocator,
    id: i64,
    expression: []const u8,
    return_by_value: bool,
    await_promise: bool,
    user_gesture: bool,
) ![]u8 {
    const method_json = try jsonStringAlloc(allocator, "Runtime.evaluate");
    defer allocator.free(method_json);
    const expr_json = try jsonStringAlloc(allocator, expression);
    defer allocator.free(expr_json);
    return std.fmt.allocPrint(
        allocator,
        "{{\"id\":{d},\"method\":{s},\"params\":{{\"expression\":{s},\"returnByValue\":{s},\"awaitPromise\":{s},\"userGesture\":{s}}}}}",
        .{
            id,
            method_json,
            expr_json,
            if (return_by_value) "true" else "false",
            if (await_promise) "true" else "false",
            if (user_gesture) "true" else "false",
        },
    );
}

fn buildReqSetFileInputFiles(allocator: std.mem.Allocator, id: i64, backend_node_id: i64, file_path: []const u8) ![]u8 {
    const method_json = try jsonStringAlloc(allocator, "DOM.setFileInputFiles");
    defer allocator.free(method_json);
    const file_json = try jsonStringAlloc(allocator, file_path);
    defer allocator.free(file_json);
    return std.fmt.allocPrint(
        allocator,
        "{{\"id\":{d},\"method\":{s},\"params\":{{\"backendNodeId\":{d},\"files\":[{s}]}}}}",
        .{ id, method_json, backend_node_id, file_json },
    );
}

fn buildCenterExpr(allocator: std.mem.Allocator, selector: []const u8) ![]u8 {
    const sel_json = try jsonStringAlloc(allocator, selector);
    defer allocator.free(sel_json);
    return std.fmt.allocPrint(
        allocator,
        "(() => {{ const sel = {s}; const el = document.querySelector(sel); if (!el) return {{ ok: false, reason: 'not_found', selector: sel }}; try {{ el.scrollIntoView({{ block: 'center', inline: 'center' }}); }} catch (_) {{}} const r = el.getBoundingClientRect(); return {{ ok: true, selector: sel, x: r.x + r.width / 2, y: r.y + r.height / 2 }}; }})()",
        .{sel_json},
    );
}

fn buildClickExpr(allocator: std.mem.Allocator, selector: []const u8) ![]u8 {
    const sel_json = try jsonStringAlloc(allocator, selector);
    defer allocator.free(sel_json);
    return std.fmt.allocPrint(
        allocator,
        "(() => {{ const sel = {s}; const el = document.querySelector(sel); if (!el) return {{ ok: false, reason: 'not_found', selector: sel }}; el.click(); return {{ ok: true, selector: sel, id: String(el.id || ''), tag: String(el.tagName || ''), type: String(el.type || '') }}; }})()",
        .{sel_json},
    );
}

const Point = struct {
    x: f64,
    y: f64,
};

fn extractPoint(allocator: std.mem.Allocator, msg: []const u8) !Point {
    var parsed = try std.json.parseFromSlice(std.json.Value, allocator, msg, .{});
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidJson;

    const result0 = parsed.value.object.get("result") orelse return error.MissingField;
    if (result0 != .object) return error.InvalidFieldType;
    const result1 = result0.object.get("result") orelse return error.MissingField;
    if (result1 != .object) return error.InvalidFieldType;
    const value = result1.object.get("value") orelse return error.MissingField;
    if (value != .object) return error.InvalidFieldType;

    const okv = value.object.get("ok") orelse return error.MissingField;
    if (okv != .bool) return error.InvalidFieldType;
    if (!okv.bool) return error.NotFound;

    const xv = value.object.get("x") orelse return error.MissingField;
    const yv = value.object.get("y") orelse return error.MissingField;
    const x: f64 = switch (xv) {
        .float => |f| f,
        .integer => |i| @floatFromInt(i),
        else => return error.InvalidFieldType,
    };
    const y: f64 = switch (yv) {
        .float => |f| f,
        .integer => |i| @floatFromInt(i),
        else => return error.InvalidFieldType,
    };

    return .{ .x = x, .y = y };
}

fn buildReqMouseEvent(
    allocator: std.mem.Allocator,
    id: i64,
    event_type: []const u8,
    x: f64,
    y: f64,
    button: ?[]const u8,
    click_count: ?i64,
) ![]u8 {
    const method_json = try jsonStringAlloc(allocator, "Input.dispatchMouseEvent");
    defer allocator.free(method_json);
    const type_json = try jsonStringAlloc(allocator, event_type);
    defer allocator.free(type_json);

    if (button) |b| {
        const button_json = try jsonStringAlloc(allocator, b);
        defer allocator.free(button_json);
        const cc = click_count orelse 1;
        return std.fmt.allocPrint(
            allocator,
            "{{\"id\":{d},\"method\":{s},\"params\":{{\"type\":{s},\"x\":{d},\"y\":{d},\"button\":{s},\"clickCount\":{d}}}}}",
            .{ id, method_json, type_json, x, y, button_json, cc },
        );
    }

    return std.fmt.allocPrint(
        allocator,
        "{{\"id\":{d},\"method\":{s},\"params\":{{\"type\":{s},\"x\":{d},\"y\":{d}}}}}",
        .{ id, method_json, type_json, x, y },
    );
}

fn buildVerifyExpr(allocator: std.mem.Allocator, file_path: []const u8) ![]u8 {
    const base = std.fs.path.basename(file_path);
    const name_json = try jsonStringAlloc(allocator, base);
    defer allocator.free(name_json);
    return std.fmt.allocPrint(
        allocator,
        "(() => {{ const name = {s}; const inputs = Array.from(document.querySelectorAll('input[type=file]')); const picked = inputs.map((i) => {{ try {{ return {{ accept: String(i.accept||''), n: (i.files?i.files.length:0), names: i.files?Array.from(i.files).map((f)=>f.name):[] }}; }} catch (e) {{ return {{ accept: String(i.accept||''), n: 0, names: [] }}; }} }}); const any = picked.some((x) => (x.names || []).includes(name)); const aria = Array.from(document.querySelectorAll('[aria-label]')).map((e)=>String(e.getAttribute('aria-label')||'')); const hasTile = aria.includes(name); return {{ href: location.href, title: document.title, name, any_input_has_name: any, inputs: picked, has_aria_label_tile: hasTile }}; }})()",
        .{name_json},
    );
}

fn jsonStringAlloc(allocator: std.mem.Allocator, s: []const u8) ![]u8 {
    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(allocator);
    try writeJsonString(out.writer(allocator), s);
    return out.toOwnedSlice(allocator);
}

fn setRecvTimeout(stream: std.net.Stream, timeout_ms: u32) !void {
    const tv = std.posix.timeval{
        .sec = @as(isize, @intCast(timeout_ms / 1000)),
        .usec = @as(isize, @intCast((timeout_ms % 1000) * 1000)),
    };
    try std.posix.setsockopt(stream.handle, std.posix.SOL.SOCKET, std.posix.SO.RCVTIMEO, std.mem.asBytes(&tv));
}

fn genSecWebSocketKey(allocator: std.mem.Allocator) ![]u8 {
    var rnd: [16]u8 = undefined;
    std.crypto.random.bytes(&rnd);

    // base64 output length for 16 bytes is 24
    var buf: [24]u8 = undefined;
    const encoded = std.base64.standard.Encoder.encode(&buf, &rnd);
    return allocator.dupe(u8, encoded);
}

fn computeSecWebSocketAccept(allocator: std.mem.Allocator, sec_key: []const u8) ![]u8 {
    const magic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    const joined = try std.fmt.allocPrint(allocator, "{s}{s}", .{ sec_key, magic });
    defer allocator.free(joined);

    var digest: [20]u8 = undefined;
    std.crypto.hash.Sha1.hash(joined, &digest, .{});

    // base64 output length for 20 bytes is 28
    var buf: [28]u8 = undefined;
    const encoded = std.base64.standard.Encoder.encode(&buf, &digest);
    return allocator.dupe(u8, encoded);
}

fn wsHandshake(allocator: std.mem.Allocator, bs: *BufferedStream, host: []const u8, port: u16, path: []const u8, sec_key: []const u8, accept_expected: []const u8) !void {
    var req_buf: [2048]u8 = undefined;
    const req = try std.fmt.bufPrint(
        &req_buf,
        "GET {s} HTTP/1.1\r\n" ++
            "Host: {s}:{d}\r\n" ++
            "Upgrade: websocket\r\n" ++
            "Connection: Upgrade\r\n" ++
            "Sec-WebSocket-Key: {s}\r\n" ++
            "Sec-WebSocket-Version: 13\r\n" ++
            "\r\n",
        .{ path, host, port, sec_key },
    );
    try bs.stream.writeAll(req);

    const hdr_bytes = try bs.readHeaders(allocator, 64 * 1024);
    defer allocator.free(hdr_bytes);

    if (!is101SwitchingProtocols(hdr_bytes)) return error.HandshakeFailed;

    const accept = findHeaderValue(hdr_bytes, "sec-websocket-accept") orelse return error.HandshakeFailed;
    if (!std.mem.eql(u8, std.mem.trim(u8, accept, " \t\r\n"), accept_expected)) return error.HandshakeFailed;
}

fn is101SwitchingProtocols(headers: []const u8) bool {
    // naive: check for " 101 " in status line
    const first_line_end = std.mem.indexOf(u8, headers, "\r\n") orelse headers.len;
    const line = headers[0..first_line_end];
    return std.mem.indexOf(u8, line, " 101 ") != null;
}

fn findHeaderValue(headers: []const u8, key_lower: []const u8) ?[]const u8 {
    var it = std.mem.splitSequence(u8, headers, "\r\n");
    _ = it.next(); // status line
    while (it.next()) |line| {
        if (line.len == 0) break;
        if (std.mem.indexOfScalar(u8, line, ':')) |colon| {
            const k = std.mem.trim(u8, line[0..colon], " \t");
            const v = std.mem.trim(u8, line[(colon + 1)..], " \t");
            if (std.ascii.eqlIgnoreCase(k, key_lower)) {
                return v;
            }
        }
    }
    return null;
}

// readUntilHeadersEnd removed: BufferedStream.readHeaders keeps leftovers

fn wsSendText(stream: std.net.Stream, text: []const u8) !void {
    try wsSendFrame(stream, 0x1, text);
}

fn wsSendPong(stream: std.net.Stream, payload: []const u8) !void {
    try wsSendFrame(stream, 0xA, payload);
}

fn wsSendFrame(stream: std.net.Stream, opcode: u8, payload: []const u8) !void {
    // Client-to-server frames MUST be masked.
    var header: [14]u8 = undefined;
    var hlen: usize = 0;

    header[0] = 0x80 | (opcode & 0x0F); // FIN=1
    hlen = 1;

    const mask_bit: u8 = 0x80;
    const len = payload.len;
    if (len <= 125) {
        header[1] = mask_bit | @as(u8, @intCast(len));
        hlen = 2;
    } else if (len <= 0xFFFF) {
        header[1] = mask_bit | 126;
        header[2] = @as(u8, @intCast((len >> 8) & 0xFF));
        header[3] = @as(u8, @intCast(len & 0xFF));
        hlen = 4;
    } else {
        header[1] = mask_bit | 127;
        const l: u64 = @intCast(len);
        header[2] = @as(u8, @intCast((l >> 56) & 0xFF));
        header[3] = @as(u8, @intCast((l >> 48) & 0xFF));
        header[4] = @as(u8, @intCast((l >> 40) & 0xFF));
        header[5] = @as(u8, @intCast((l >> 32) & 0xFF));
        header[6] = @as(u8, @intCast((l >> 24) & 0xFF));
        header[7] = @as(u8, @intCast((l >> 16) & 0xFF));
        header[8] = @as(u8, @intCast((l >> 8) & 0xFF));
        header[9] = @as(u8, @intCast(l & 0xFF));
        hlen = 10;
    }

    var mask: [4]u8 = undefined;
    std.crypto.random.bytes(&mask);

    header[hlen] = mask[0];
    header[hlen + 1] = mask[1];
    header[hlen + 2] = mask[2];
    header[hlen + 3] = mask[3];
    hlen += 4;

    try stream.writeAll(header[0..hlen]);

    // Write masked payload.
    var chunk: [4096]u8 = undefined;
    var i: usize = 0;
    while (i < payload.len) {
        const n = @min(payload.len - i, chunk.len);
        for (0..n) |j| {
            const idx = i + j;
            chunk[j] = payload[idx] ^ mask[idx % 4];
        }
        try stream.writeAll(chunk[0..n]);
        i += n;
    }
}

const WsFrame = struct {
    fin: bool,
    opcode: u8,
    payload: []u8,
};

fn wsReadFrame(allocator: std.mem.Allocator, bs: *BufferedStream) !WsFrame {
    var hdr2: [2]u8 = undefined;
    try bs.readExact(&hdr2);

    const b0 = hdr2[0];
    const b1 = hdr2[1];

    const fin = (b0 & 0x80) != 0;
    const opcode: u8 = b0 & 0x0F;
    const masked = (b1 & 0x80) != 0;
    const len7: u64 = b1 & 0x7F;
    var payload_len: u64 = 0;

    if (len7 <= 125) {
        payload_len = len7;
    } else if (len7 == 126) {
        var ext: [2]u8 = undefined;
        try bs.readExact(&ext);
        payload_len = (@as(u64, ext[0]) << 8) | @as(u64, ext[1]);
    } else {
        var ext: [8]u8 = undefined;
        try bs.readExact(&ext);
        payload_len = 0;
        for (ext) |c| {
            payload_len = (payload_len << 8) | @as(u64, c);
        }
    }

    var mask: [4]u8 = .{ 0, 0, 0, 0 };
    if (masked) {
        try bs.readExact(&mask);
    }

    if (payload_len > 64 * 1024 * 1024) return error.FrameTooLarge;
    const plen: usize = @intCast(payload_len);
    const payload = try allocator.alloc(u8, plen);
    errdefer allocator.free(payload);
    try bs.readExact(payload);
    if (masked) {
        for (payload, 0..) |*c, idx| {
            c.* = c.* ^ mask[idx % 4];
        }
    }

    return .{ .fin = fin, .opcode = opcode, .payload = payload };
}

fn wsReadTextMessage(allocator: std.mem.Allocator, bs: *BufferedStream) ![]u8 {
    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(allocator);

    var in_text = false;
    while (true) {
        const frame = try wsReadFrame(allocator, bs);
        defer allocator.free(frame.payload);

        switch (frame.opcode) {
            0x9 => { // ping
                try wsSendPong(bs.stream, frame.payload);
                continue;
            },
            0xA => continue, // pong
            0x8 => return error.ConnectionClosed,
            0x1 => {
                // text start
                out.clearRetainingCapacity();
                in_text = true;
                try out.appendSlice(allocator, frame.payload);
                if (frame.fin) return out.toOwnedSlice(allocator);
            },
            0x0 => {
                // continuation
                if (!in_text) continue;
                try out.appendSlice(allocator, frame.payload);
                if (frame.fin) return out.toOwnedSlice(allocator);
            },
            else => {
                // ignore other opcodes
                continue;
            },
        }
    }
}

// readExact handled by BufferedStream
