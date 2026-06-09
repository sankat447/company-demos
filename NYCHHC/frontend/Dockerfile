# NYC H+H Streamlit role app. Single-stage UBI python (OpenShift arbitrary-UID safe).
FROM registry.access.redhat.com/ubi9/python-311:latest

WORKDIR /opt/app-root/src

COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip && pip install --no-cache-dir -r requirements.txt

COPY . ./

# In-cluster the backend is reached by Service DNS; overridden via env in the manifest.
ENV NYCHHC_BACKEND_URL=http://nychhc-copilot.nychhc-demo.svc:8080 \
    PYTHONUNBUFFERED=1

EXPOSE 8501

CMD ["streamlit", "run", "app.py", "--server.port=8501", "--server.address=0.0.0.0"]
