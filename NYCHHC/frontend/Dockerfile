# NYC H+H wireframe — served as a static branded SPA (replaces the Streamlit app).
# Single-stage UBI python (OpenShift arbitrary-UID safe). Phase 2 wires the inline
# ROSTER/RISK/PTO/BAL arrays to the backend data API + Copilot to the granite LLM.
FROM registry.access.redhat.com/ubi9/python-311:latest

WORKDIR /opt/app-root/src
COPY index.html ./
COPY css ./css
COPY js ./js
COPY assets ./assets
COPY demoer ./demoer

EXPOSE 8501
# Simple static server (demo-grade). Serves index.html at /.
CMD ["python", "-m", "http.server", "8501"]
