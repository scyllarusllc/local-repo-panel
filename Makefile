PORT ?= 8080
.PHONY: dev server test
dev:
	@PORT=$(PORT) npm run dev
server:
	@PORT=$(PORT) npm start
test:
	@npm test
