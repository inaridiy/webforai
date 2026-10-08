# AUTO-GENERATED. DO NOT EDIT.
FROM node:24.21.0-bookworm-slim
WORKDIR /app
RUN npx -y playwright@1.62.1 install --with-deps --only-shell chromium && rm -rf /var/lib/apt/lists/* /root/.npm
# Install deps (only externals declared via plugin options)
COPY package.json ./
RUN corepack enable && pnpm install --prod --no-frozen-lockfile
# Server bundle
COPY ./server.mjs ./server.mjs
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "./server.mjs"]