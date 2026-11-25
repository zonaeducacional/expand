FROM node:24-alpine
WORKDIR /app
COPY server/package*.json ./server/
RUN npm ci --prefix server --omit=dev --no-audit --no-fund
COPY server/*.js ./server/
COPY dist ./dist
RUN mkdir /data && chown node:node /data
USER node
ENV EXPAND_DATA=/data
CMD ["node", "server/index.js"]
