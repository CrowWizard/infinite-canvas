# 不使用 Docker 的部署说明

本文说明如何在 Linux 服务器上直接部署无限画布项目，不使用 Docker。

## 一、部署架构

```text
用户浏览器
        ↓
Nginx :80 / :443
        ├── 静态前端：web/out
        └── /api/* → Go API :8080
                         ↓
                   PostgreSQL
```

生产环境由 Nginx 直接托管静态前端 `web/out`，并将 `/api/` 转发到监听 `8080` 的 Go API。

## 二、环境要求

需要安装：

```text
Go 1.25+
Node.js 22+
Bun 1.3+
Git
Nginx，可选
```

检查版本：

```bash
go version
node --version
bun --version
git --version
```

## 三、获取项目

以下以 `/opt/infinite-canvas` 为项目目录：

```bash
sudo mkdir -p /opt
git clone https://github.com/tigerowo/infinite-canvas.git /opt/infinite-canvas
sudo chown -R "$USER":"$USER" /opt/infinite-canvas
cd /opt/infinite-canvas
```

## 四、配置环境变量

```bash
cd /opt/infinite-canvas
cp .env.example .env
mkdir -p data
nano .env
```

至少检查并修改：

```env
PORT=8080
ADMIN_USERNAME=admin
ADMIN_PASSWORD=请修改为强密码
JWT_SECRET=请修改为随机长字符串
```

生成随机 JWT Secret：

```bash
openssl rand -base64 48
```

不要在生产环境使用默认值：

```text
ADMIN_PASSWORD=infinite-canvas
JWT_SECRET=infinite-canvas
```

当前版本为 PostgreSQL 专用构建，需要先准备 PostgreSQL 数据库，并在 `.env` 中配置连接信息：

```env
STORAGE_DRIVER=postgres
DATABASE_DSN=host=127.0.0.1 user=infinite_canvas password=你的密码 dbname=infinite_canvas port=5432 sslmode=disable
```

## 五、启动后端

### 测试运行

在项目根目录执行：

```bash
cd /opt/infinite-canvas
go mod download
go run .
```

后端监听：

```text
http://127.0.0.1:8080
```

健康检查：

```bash
curl http://127.0.0.1:8080/api/health
```

正常返回：

```text
ok
```

### 编译运行

生产环境建议先编译：

```bash
cd /opt/infinite-canvas
go mod download
go build -o infinite-canvas-server .
mkdir -p bin
cp infinite-canvas-server bin/
./bin/infinite-canvas-server
```

运行时建议使用项目根目录作为工作目录，以便正确读取 `.env` 和 `data/`。

## 六、启动前端

### 开发模式

```bash
cd /opt/infinite-canvas/web
bun install --frozen-lockfile
bun run dev
```

访问：

```text
http://服务器IP
```

### 生产静态构建

```bash
cd /opt/infinite-canvas/web
bun install --frozen-lockfile
bun run build
```

静态文件输出到 `/opt/infinite-canvas/web/out`。前端使用相对路径访问 `/api/*`，由同域名下的 Nginx 转发到 Go 后端。

画布编辑页使用以下静态 URL 格式：

```text
/canvas?id=项目ID
```



## 七、最简单的启动方式

打开两个终端。

终端一启动后端：

```bash
cd /opt/infinite-canvas
go run .
```

终端二启动前端：

```bash
cd /opt/infinite-canvas/web
bun install --frozen-lockfile
bun run dev
```

浏览器访问：

```text
http://服务器IP
```

## 八、使用 systemd 持久运行

生产环境建议使用 systemd，避免 SSH 断开后服务停止。

### 后端服务

创建：

```bash
sudo nano /etc/systemd/system/infinite-canvas-api.service
```

写入以下内容，并将 `你的Linux用户名` 替换为实际用户：

```ini
[Unit]
Description=Infinite Canvas Go API
After=network.target

[Service]
Type=simple
User=你的Linux用户名
WorkingDirectory=/opt/infinite-canvas
ExecStart=/opt/infinite-canvas/bin/infinite-canvas-server
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

启用并启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now infinite-canvas-api
```

查看状态和日志：

```bash
sudo systemctl status infinite-canvas-api
journalctl -u infinite-canvas-api -f
```

### 静态前端

构建完成后，静态文件位于：

```text
/opt/infinite-canvas/web/out
```

Nginx 直接托管该目录，不需要启动 Next.js 服务。

## 九、使用 Nginx 反向代理

安装 Nginx：

```bash
sudo apt update
sudo apt install -y nginx
```

创建站点配置：

```bash
sudo nano /etc/nginx/sites-available/infinite-canvas
```

内容如下，将 `your-domain.com` 替换为实际域名：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    root /opt/infinite-canvas/web/out;
    index index.html;
    client_max_body_size 100m;

    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri.html $uri/ /404.html;
    }
}
```

启用并检查：

```bash
sudo ln -s /etc/nginx/sites-available/infinite-canvas /etc/nginx/sites-enabled/infinite-canvas
sudo nginx -t
sudo systemctl reload nginx
```

访问：

```text
http://your-domain.com
```

请求链路：

```text
用户
  ↓
Nginx :80 / :443
  ↓
静态前端：web/out
  ↓ /api/*
Go API :8080
```

## 十、配置 HTTPS

安装 Certbot：

```bash
sudo apt install -y certbot python3-certbot-nginx
```

申请证书：

```bash
sudo certbot --nginx -d your-domain.com
```

测试自动续期：

```bash
sudo certbot renew --dry-run
```

Nginx 应保留以下请求头：

```nginx
proxy_set_header X-Forwarded-Proto $scheme;
```

这对 HTTPS 下的安全 Cookie 和匿名文件存储会话很重要。

## 十一、更新版本

```bash
cd /opt/infinite-canvas
git pull
go mod download
go build -o infinite-canvas-server .
cp infinite-canvas-server bin/

cd web
bun install --frozen-lockfile
bun run build

sudo systemctl restart infinite-canvas-api
```

检查：

```bash
sudo systemctl status infinite-canvas-api
```

## 十二、常见问题

### 前端打开但接口失败

```bash
curl http://127.0.0.1:8080/api/health
journalctl -u infinite-canvas-api -n 100 --no-pager
```

确认 Go API 正常运行，并检查 Nginx 的 `/api/` 代理配置是否指向正确的后端地址。

### Nginx 返回 502

通常是 Go API 没有运行，或 Nginx 的 `/api/` 代理配置不正确：

```bash
sudo systemctl status infinite-canvas-api
journalctl -u infinite-canvas-api -n 100 --no-pager
```

### 前端构建失败

```bash
cd /opt/infinite-canvas/web
bun install --frozen-lockfile
bun run build
```

同时确认项目根目录的以下文件存在：

```text
VERSION
CHANGELOG.md
```

`web/next.config.ts` 会读取这两个文件。

### 数据库无法创建

```bash
cd /opt/infinite-canvas
mkdir -p data
sudo chown -R 你的Linux用户名:你的Linux用户名 data
```

### AI、图片或视频任务失败

检查：

- 后台 AI 渠道是否配置。
- API Key 是否有效。
- 模型名称是否正确。
- 服务器是否能访问第三方 AI 服务。
- `PUBLIC_BASE_URL` 是否为上游服务可以访问的公网地址。
- 参考媒体是否能被火山等上游服务访问。

### Cookie 或匿名文件存储异常

检查：

- 不要混用 IP 地址和域名访问。
- Nginx 是否传递 `X-Forwarded-Proto`。
- HTTPS 配置是否正确。
- 浏览器是否阻止 Cookie。

## 十三、安全和运维建议

- 修改默认管理员密码。
- 使用随机且足够长的 `JWT_SECRET`。
- 仅开放 SSH、HTTP 和 HTTPS 端口。
- Go API 和 Next.js 尽量只监听 `127.0.0.1`，通过 Nginx 对外提供访问。
- 定期备份 `data/` 目录或外部数据库。
- 不要把 `.env` 提交到 Git。
- 本地直连模式的 AI API Key 保存在浏览器本地，不能视为服务端密钥托管。
- Docker 静态资源路径仍属于待验证事项，本说明不对 Docker 部署作承诺。
