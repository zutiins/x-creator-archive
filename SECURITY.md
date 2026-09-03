# Security Policy

## Reporting a vulnerability

如果发现安全问题，请不要在公开 Issue、Pull Request 或 Discussion 中提交管理员密码、X Cookie、Token、代理凭据、用户数据或其他敏感信息。

请通过私密渠道联系仓库维护者，并提供复现步骤、影响范围和必要的脱敏日志。

## Sensitive data

本项目的实际运行数据和凭据不应提交到 Git 仓库，包括：

- `.admin-password`
- `.env`
- `data/creators.json`
- `data/lists.json`
- `data/settings.json`
- `data/sync-history.json`
- `import/`
- Cookie、Token 和代理凭据

公开仓库前应检查 Git 暂存区和提交历史，确认其中不存在上述信息。
