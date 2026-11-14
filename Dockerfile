FROM apify/actor-node:22 AS builder

COPY --chown=myuser:myuser package*.json ./
RUN npm install --include=dev --audit=false

COPY --chown=myuser:myuser tsconfig.json ./
COPY --chown=myuser:myuser src ./src
RUN npm run build

FROM apify/actor-node:22

COPY --chown=myuser:myuser package*.json ./
RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional --audit=false \
    && rm -rf ~/.npm

COPY --chown=myuser:myuser --from=builder /home/myuser/dist ./dist
COPY --chown=myuser:myuser .actor ./.actor

CMD ["node", "dist/main.js"]
