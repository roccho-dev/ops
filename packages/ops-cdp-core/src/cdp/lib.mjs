// barrel(後方互換 re-export)。実装は core/ domain/ cli/ へ移設済。
// 既存 importer(usecases/chatgpt/connect/tests)は変更不要。
// 新規コードは各モジュールを直接 import すること。Phase2(package 分割)で本 barrel は削除予定。
export * from "./core/result.mjs";
export * from "./core/config.mjs";
export * from "./core/proc.mjs";
export * from "./core/cdp-client.mjs";
export * from "./domain/auth.mjs";
export * from "./cli/cli.mjs";
