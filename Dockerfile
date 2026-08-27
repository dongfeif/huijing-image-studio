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

CMD ["node", "server.mjs"]
