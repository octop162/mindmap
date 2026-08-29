.PHONY: dev build preview clean

node_modules: package.json
	npm install
	touch node_modules

dev: node_modules
	npm run dev

build: node_modules
	npm run build

preview: node_modules
	npm run preview

clean:
	rm -rf node_modules dist
