FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run dist \
    && mkdir -p /site/tests \
    && cp -r index.html dist examples /site \
    && cp -r tests/screenshots /site/tests/screenshots

FROM nginx:1.27-alpine

COPY --from=build /site/ /usr/share/nginx/html/

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
