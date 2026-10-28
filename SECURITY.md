# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.1.x   | :white_check_mark: |
| 1.0.x   | :x:                |

## Production Security Best Practices

1. **Strong `PUBLISH_SECRET_KEY`**: Always configure a high-entropy secret (at least 32 random bytes) in production. ChronoStream refuses to boot in `NODE_ENV=production` if `PUBLISH_SECRET_KEY` is omitted.
2. **Encrypted Redis Transport (`rediss://`)**: Use TLS-enabled Redis connections (`rediss://`) when connecting to managed Redis providers such as Upstash or Redis Cloud.
3. **Strict `ALLOWED_ORIGINS`**: Set `ALLOWED_ORIGINS` to a comma-separated list of trusted frontend origins in production rather than `*`.
4. **Private Channels**: Prefix sensitive user or tenant streams with `private:` or `private-` and issue short-lived HMAC tokens via `POST /auth/token`.
5. **Rate Limiting**: Tune `RATE_LIMIT_MAX` according to your backend publishing throughput and place ChronoStream behind a reverse proxy or CDN (e.g., Cloudflare, Nginx) in production.

## Reporting a Vulnerability

If you discover a security vulnerability in ChronoStream, please do **not** open a public issue. Instead, report it privately via GitHub Security Advisories on the repository:

- **URL**: `https://github.com/fiizam/ChronoStream/security/advisories/new`

Please include a clear description of the issue, steps to reproduce, and potential impact. We aim to acknowledge reports within 48 hours and provide a fix or mitigation plan promptly.
