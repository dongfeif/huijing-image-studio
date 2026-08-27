FROM node:22-alpine

WORKDIR /app
COPY package.json server.mjs ./
COPY data ./data
COPY public ./public
RUN mkdir -p /app/.runtime

ENV PORT=3000
ENV HOST=0.0.0.0
ENV CONFIG_PATH=/app/.runtime/config.json
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "server.mjs"]
