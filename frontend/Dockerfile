FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

ARG BACKEND_URL=http://backend:8000
ENV BACKEND_URL=${BACKEND_URL}

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start"]
