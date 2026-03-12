# OpenClaw Dashboard Pro

[English](./README.md)

## 解决什么问题
OpenClaw Dashboard Pro 是本地可视化控制台，帮你用浏览器低门槛管理 OpenClaw。服务启动后，大多数操作无需再手动执行 OpenClaw 命令行。

## 你可以做什么
- 检查 OpenClaw 是否已安装、是否最新
- 一键安装与更新 OpenClaw
- 切换模型并做连通性测试
- 控制网关（启动 / 重启 / 停止 / 状态）
- 管理 Session（新建 / 清理 / 列表）
- 获取优化建议与技能推荐

## 适用人群
- 想快速上手 OpenClaw 的本地用户
- 需要可视化管理与运维 OpenClaw 的团队

## 环境要求
- Node.js 18+
- macOS / Linux（Windows 可用 WSL）
- 已安装 `openclaw`（可在页面一键安装）

## 快速开始
1. 获取代码
```bash
git clone <你的仓库地址> openclaw-dashboard-pro
cd openclaw-dashboard-pro
```

2. 启动服务
```bash
node server.mjs
```

3. 打开页面
```text
http://127.0.0.1:19190
```

## 界面截图
总览（安装 + 网关）
![总览](./docs/screenshots/overview.png)

配置（模型切换 + OpenAI Chat）
![配置](./docs/screenshots/configure.png)

优化（技能与推荐）
![优化](./docs/screenshots/optimize.png)

## 配置说明
- 端口：`PORT`（默认 `19190`）
- 绑定地址：`HOST`（默认 `0.0.0.0`）

## 安全与隐私
- 本仓库不包含任何密钥或 Token。
- 页面中填写的 API Key 只会写入本机 OpenClaw 配置目录的 `models.json`（不在本仓库内）。
- 请勿把 OpenClaw 配置目录提交到仓库。

## 文档
- English：`docs/Usage.md`
- 中文：`docs/使用文档.md`

## 目录结构
```text
.
├── server.mjs          # 本地 HTTP 服务
├── public/             # 前端静态资源
├── docs/               # 使用文档（中文）
└── .gitignore
```

## 常见问题
1. 页面打不开  
确认服务仍在运行，并检查 19190 端口是否监听：
```bash
lsof -nP -iTCP:19190 -sTCP:LISTEN
```

2. 按钮无响应  
查看页面底部“命令执行输出”，并确认 `openclaw --version` 可用。

## 参与贡献
请阅读 `CONTRIBUTING.md`。

## 安全报告
请阅读 `SECURITY.md`。

## 许可证
MIT License，见 `LICENSE`。
