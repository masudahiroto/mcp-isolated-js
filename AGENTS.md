# mcp-isolated-js

MCP (Model Context Protocol) 経由でJavaScriptコードをサンドボックス内で安全に実行するためのサーバー。Denoによる隔離実行環境と、プラグインシステムによる機能拡張を提供する。

## テスト手順

sandbox環境ではDenoのJSRパッケージ取得ができないため、事前にキャッシュを作成する必要がある。

```bash
# 1. sandbox外でDenoキャッシュを作成
DENO_DIR=/tmp/mcp-isolated-js-deno-cache deno cache --config sandbox/deno.json sandbox/sandbox.ts

# 2. キャッシュを指定してテスト実行
DENO_DIR=/tmp/mcp-isolated-js-deno-cache bun test
```