
FROM node:20-bookworm-slim

WORKDIR /app

COPY ["AegisNet (6)/package.json", "./package.json"]
COPY ["AegisNet (6)/package-lock.json", "./package-lock.json"]
RUN npm install

COPY ["AegisNet (6)/backend", "./backend"]
COPY ["AegisNet (6)/frontend", "./frontend"]

RUN npm install --prefix backend
RUN npm install --prefix frontend
RUN npm run build --prefix frontend

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["npm", "start", "--prefix", "backend"]
