FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY backend ./backend
COPY frontend ./frontend

RUN npm install --prefix backend
RUN npm install --prefix frontend
RUN npm run build --prefix frontend

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["npm", "start", "--prefix", "backend"]