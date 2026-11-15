PORT ?= 8080
.PHONY: deps dev server test

deps:
	@if [ ! -x node_modules/.bin/tailwindcss ] || [ ! -d node_modules ]; then \
		echo "Installing project dependencies..."; \
		npm ci; \
	fi

dev:
	@$(MAKE) --no-print-directory deps
	@PORT=$(PORT) npm run dev
server:
	@$(MAKE) --no-print-directory deps
	@PORT=$(PORT) npm start
test:
	@$(MAKE) --no-print-directory deps
	@npm test
