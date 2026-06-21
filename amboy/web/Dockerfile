# Amboy web UI — build the Vite app, serve via unprivileged nginx (OpenShift
# arbitrary-UID safe; listens on 8080 as non-root). node->nginx multi-stage is
# fine here (no UBI lib64 symlink concern).
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
