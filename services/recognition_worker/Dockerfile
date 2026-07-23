FROM public.ecr.aws/lambda/python:3.12@sha256:0628ddc11919f85f4261517d356392dbbc6b3181568d87a376ae2e814464c230 AS build

RUN pip install --no-cache-dir uv==0.8.13
COPY pyproject.toml uv.lock /build/
WORKDIR /build
RUN uv export --frozen --no-dev --no-emit-project --extra recognition --format requirements-txt > requirements.txt \
    && pip install --no-cache-dir --target "${LAMBDA_TASK_ROOT}" -r requirements.txt

COPY packages/python_domain/gatesight_domain "${LAMBDA_TASK_ROOT}/gatesight_domain"
COPY services/recognition_worker/gatesight_recognition_worker "${LAMBDA_TASK_ROOT}/gatesight_recognition_worker"
COPY ml/download_models.py ml/model-manifest.json /build/ml/

RUN mkdir -p /opt/models \
    && python /build/ml/download_models.py --manifest /build/ml/model-manifest.json --output /opt/models --verify

FROM public.ecr.aws/lambda/python:3.12@sha256:0628ddc11919f85f4261517d356392dbbc6b3181568d87a376ae2e814464c230
COPY --from=build "${LAMBDA_TASK_ROOT}" "${LAMBDA_TASK_ROOT}"
COPY --from=build /opt/models /opt/models
ENV GATESIGHT_MODEL_DIRECTORY=/opt/models \
    GATESIGHT_PRELOAD_MODELS=1 \
    ORT_LOG_SEVERITY_LEVEL=3
CMD ["gatesight_recognition_worker.handler.handler"]
