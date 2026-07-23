FROM public.ecr.aws/lambda/python:3.12@sha256:0628ddc11919f85f4261517d356392dbbc6b3181568d87a376ae2e814464c230 AS build

RUN pip install --no-cache-dir uv==0.8.13
COPY pyproject.toml uv.lock /build/
WORKDIR /build
RUN uv export --frozen --no-dev --no-emit-project --extra recognition --format requirements-txt > requirements.txt \
    && pip install --no-cache-dir --target "${LAMBDA_TASK_ROOT}" -r requirements.txt

COPY packages/python_domain/gatesight_domain "${LAMBDA_TASK_ROOT}/gatesight_domain"
COPY services/recognition_worker/gatesight_recognition_worker "${LAMBDA_TASK_ROOT}/gatesight_recognition_worker"
COPY ml/download_models.py ml/model-manifest.json /build/ml/

ARG GATESIGHT_MODEL_RELEASE_SCOPE=portfolio
RUN mkdir -p /opt/models \
    && case "${GATESIGHT_MODEL_RELEASE_SCOPE}" in \
      portfolio) RELEASE_FLAG=--require-portfolio-scope ;; \
      commercial) RELEASE_FLAG=--require-redistribution-approval ;; \
      *) echo "Unsupported model release scope: ${GATESIGHT_MODEL_RELEASE_SCOPE}" >&2; exit 2 ;; \
    esac \
    && python /build/ml/download_models.py \
      --manifest /build/ml/model-manifest.json \
      --output /opt/models \
      --verify \
      "${RELEASE_FLAG}"

FROM public.ecr.aws/lambda/python:3.12@sha256:0628ddc11919f85f4261517d356392dbbc6b3181568d87a376ae2e814464c230
RUN dnf upgrade -y --releasever=latest glib2 libacl \
    && dnf clean all \
    && rm -rf /var/cache/dnf
COPY --from=build "${LAMBDA_TASK_ROOT}" "${LAMBDA_TASK_ROOT}"
COPY --from=build /opt/models /opt/models
ENV GATESIGHT_MODEL_DIRECTORY=/opt/models \
    GATESIGHT_PRELOAD_MODELS=1 \
    ORT_LOG_SEVERITY_LEVEL=3
CMD ["gatesight_recognition_worker.handler.handler"]
