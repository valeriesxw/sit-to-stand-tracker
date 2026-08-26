FROM nginxinc/nginx-unprivileged:stable-alpine

LABEL org.opencontainers.image.title="Sit-to-Stand Lab"
LABEL org.opencontainers.image.description="Browser-based 30-second sit-to-stand assessment"

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=101:101 index.html app.js style.css /usr/share/nginx/html/

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8080/healthz >/dev/null || exit 1
