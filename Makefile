SHELL := /bin/bash
ENV ?= dev
AWS_REGION ?= us-east-1
TF_DIR := infrastructure/terraform/environments/$(ENV)

.PHONY: bootstrap dev dev-web dev-api test test-unit test-integration test-e2e lint security \
	build-worker build-lambdas evaluate-models contracts tf-plan tf-apply deploy-web smoke destroy

bootstrap:
	uv sync --extra api --extra recognition --group dev
	npm --prefix apps/web ci

dev:
	@echo "Run 'make dev-api' and 'make dev-web' in separate terminals."

dev-web:
	npm --prefix apps/web run dev

dev-api:
	GATESIGHT_ENVIRONMENT=local uv run uvicorn gatesight_control_api.main:app --reload --port 8000

test: test-unit
	npm --prefix apps/web test

test-unit:
	uv run pytest tests/unit

test-integration:
	uv run pytest tests/integration

test-e2e:
	npm --prefix apps/web run test:e2e

lint:
	uv run ruff format --check .
	uv run ruff check .
	uv run mypy packages services
	npm --prefix apps/web run lint
	npm --prefix apps/web run typecheck
	terraform fmt -check -recursive infrastructure/terraform

security:
	uv run bandit -c pyproject.toml -r packages services scripts ml
	uv run pip-audit
	gitleaks detect --source . --no-banner
	uvx --from checkov==3.2.471 checkov -d infrastructure/terraform

build-worker:
	docker build --platform linux/amd64 -f services/recognition_worker/Dockerfile -t gatesight-recognition:local .

build-lambdas:
	docker build --platform linux/arm64 -f infrastructure/lambda/Dockerfile.zip --output type=local,dest=build .

evaluate-models:
	@echo "Provide rights-cleared predictions; see ml/evaluation/README.md."

contracts:
	uv run python scripts/export_openapi.py
	npm --prefix apps/web exec -- openapi-typescript packages/contracts/openapi.json \
		-o apps/web/src/api/openapi.generated.ts

tf-plan: build-lambdas
	terraform -chdir=$(TF_DIR) init -backend-config=backend.hcl
	terraform -chdir=$(TF_DIR) plan -out=tfplan

tf-apply:
	terraform -chdir=$(TF_DIR) apply tfplan

deploy-web:
	npm --prefix apps/web run build
	npx wrangler pages deploy apps/web/dist --project-name "$${CLOUDFLARE_PAGES_PROJECT}"

smoke:
	bash scripts/smoke.sh

destroy:
	@if [[ "$(ENV)" == "prod" ]]; then echo "Refusing implicit production destroy."; exit 2; fi
	terraform -chdir=$(TF_DIR) destroy
