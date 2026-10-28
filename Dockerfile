
FROM node:20

WORKDIR /app

COPY ["AegisNet (6)/package*.json", "./"]
RUN npm ci

COPY ["AegisNet (6)/", "./"]

EXPOSE 3000

CMD ["npm", "start"]
