FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

COPY index.html ./
COPY css ./css
COPY js ./js
COPY assets ./assets
COPY server/index.js ./server/index.js

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787

EXPOSE 8787
USER node

CMD ["node", "server/index.js"]
