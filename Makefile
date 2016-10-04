all:

clean: node_modules
	rm -rf node_modules

SRC_FILES = api.js hub.js sqlTemplates.js lib/*.js nef.js nef-com.js nef-hub.js
OTHER_FILES = package.json
CONFIGS = config.json
JX_FILES = hub.jxp nef.jxp nef-com.jxp nef-hub.jxp

lint:
	for f in $(SRC_FILES); do \
		echo "--- $$f ---"; \
		uglifyjs -o /dev/null --lint $$f 2>&1 ;\
	done

pack: distclean
	mkdir -p dist/hub/lib
	#npm shrinkwrap
	for f in $(SRC_FILES); do \
                cp $$f dist/hub/$$f; \
        done;
	cp $(JX_FILES) $(CONFIGS) $(OTHER_FILES) dist/hub
	( cd dist; tar zcf hub.tgz hub )

dist: distclean
	mkdir -p dist/hub/lib
	#npm shrinkwrap
	for f in $(SRC_FILES); do \
                uglifyjs $$f -m -o dist/hub/$$f; \
        done;
	cp $(JX_FILES) $(CONFIGS) $(OTHER_FILES) dist/hub
	( cd dist; tar zcf hub.tgz hub )

distclean:
	rm -rf dist

jxdist: jxdistclean
	mkdir -p jxdist/hub/lib
	for f in $(SRC_FILES); do \
		uglifyjs $$f -m -o jxdist/hub/$$f; \
	done;
	cp $(JX_FILES) $(CONFIGS) $(OTHER_FILES) jxdist/hub
	for f in $(CONFIGS); do \
		cp "$$f" jxdist/hub/$$f; \
	done;
	(cd jxdist/hub; jx compile nef.jxp ; jx compile nef-com.jxp ; jx compile nef-hub.jxp )
	(cd jxdist/hub; jx compile hub.jxp; mkdir -p node_modules; rm -f $(SRC_FILES) $(JX_FILES) ; rm -rf lib ; )
	(cd jxdist; tar zcf hub.tgz hub)

jxdistclean:
	rm -rf jxdist

.PHONY: all


