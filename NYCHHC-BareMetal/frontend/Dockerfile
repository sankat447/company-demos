# NYC H+H static branded SPA + /demoer console, served by nginx with a same-origin
# BFF proxy to the backend (iis-ai-ai). nginx-unprivileged = OpenShift arbitrary-UID
# safe (listens :8080, writes under /tmp). Build context = NYCHHC-BareMetal/frontend.
FROM nginxinc/nginx-unprivileged:stable-alpine

COPY nginx.conf /etc/nginx/nginx.conf
COPY index.html /usr/share/nginx/html/index.html
COPY css        /usr/share/nginx/html/css
COPY js         /usr/share/nginx/html/js
COPY assets     /usr/share/nginx/html/assets
COPY demoer     /usr/share/nginx/html/demoer

EXPOSE 8080
