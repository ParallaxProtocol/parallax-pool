# Developer shortcuts. Everything runs in Docker; nothing else needs to be installed.

DOTNET_SDK := mcr.microsoft.com/dotnet/sdk:10.0

.PHONY: test e2e e2e-direct dev dev-direct ui

# unit tests, as CI runs them
test:
	docker run --rm -v "$(CURDIR)":/repo -w /repo $(DOTNET_SDK) bash -c '\
		apt-get update -qq && apt-get install -y -qq make g++ git >/dev/null && \
		git config --global --add safe.directory /repo && \
		dotnet test src/Miningcore.Tests -c Release; status=$$?; \
		chown -R $(shell id -u):$(shell id -g) /repo/src; exit $$status'

# end-to-end test on a private chain: shared pool with PPLNS payouts (see tests/e2e/run.sh)
e2e:
	MODE=pool tests/e2e/run.sh

# end-to-end test on a private chain: direct rewards, no payouts
e2e-direct:
	MODE=direct tests/e2e/run.sh

# private chain + pool + miners that keep going, and the web UI with hot reload on :5173 (Ctrl+C stops)
dev:
	DEV=1 MODE=pool tests/e2e/run.sh

dev-direct:
	DEV=1 MODE=direct tests/e2e/run.sh

# build the web UI
ui:
	cd ui && npm ci && npm run build
