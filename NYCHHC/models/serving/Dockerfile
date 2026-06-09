# Version-matched sklearn predictor for the no-show + forecast KServe models.
# sklearn pinned to the training version (avoids joblib unpickle skew). Models are
# baked in from models/serving/models/{noshow,forecast}.joblib (copied by publish).
FROM registry.access.redhat.com/ubi9/python-311:latest
WORKDIR /opt/app-root/src
RUN pip install --no-cache-dir fastapi "uvicorn[standard]" "scikit-learn==1.9.0" joblib numpy
COPY predictor.py ./
COPY models ./models
EXPOSE 8080
CMD ["uvicorn", "predictor:app", "--host", "0.0.0.0", "--port", "8080"]
