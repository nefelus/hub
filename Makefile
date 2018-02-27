all:

clean: node_modules
	rm -rf node_modules

SRC_FILES = hub.js sqlTemplates.js lib/*.js nef.js nef-com.js nef-hub.js
OTHER_FILES = LICENSE.txt package.json upgrade.sh startup.sh nefelus-hub.conf
CONFIGS = hub.conf.in nefelus.conf.in

OBFUSCATOR_PARAMS = --disableConsoleOutput false --selfDefending true --stringArray true --stringArrayEncoding base64 --stringArrayThreshold 0.75 --debugProtection true --debugProtectionInterval false --controlFlowFlattening true --controlFlowFlatteningThreshold 0.75

obfdist: obfdistclean
	mkdir -p obfdist/hub/lib
	for f in $(SRC_FILES); do \
		javascript-obfuscator $$f -o "obfdist/hub/$$f" $(OBFUSCATOR_PARAMS) ; \
	done;
	cp $(CONFIGS) $(OTHER_FILES) obfdist/hub
	( cd obfdist; tar zcf hub.tgz hub )

obfdistclean:
	rm -rf obfdist

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

.PHONY: all
