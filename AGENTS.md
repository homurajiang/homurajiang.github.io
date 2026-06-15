# Agent Guidelines

## 本地预览服务安全要求

- 不要在仓库根目录直接启动会对外监听的静态文件服务，例如 `python3 -m http.server 8080`。这会暴露 `.git/`、源码和其它本地文件。
- 如需本地预览，必须只绑定本机回环地址 `127.0.0.1` / `localhost`，禁止绑定 `0.0.0.0`、`::` 或任何内网 IP。
- Python 静态预览必须使用：`python3 -m http.server 8080 --bind 127.0.0.1`。
- 其它本地开发服务也必须显式限制 host，例如 Vite 使用 `--host 127.0.0.1`，Wrangler 本地调试使用 `wrangler dev --ip 127.0.0.1`。
- 更推荐在不含 `.git/` 的临时目录中预览：复制必要的静态产物到临时目录后再启动服务。
- 启动任何本地服务前，先确认监听地址和端口；启动后用 `lsof -nP -iTCP:<port> -sTCP:LISTEN` 确认只监听 `127.0.0.1`；结束后必须停止服务，并复查端口无监听。
- 发现 `.git` 泄漏或端口暴露告警时，优先停止对应进程，再用 `lsof -nP -iTCP:<port> -sTCP:LISTEN` 与漏洞 URL 复测确认。
