all:

clean: node_modules
	rm -rf node_modules

SRC_FILES = hub.js sqlTemplates.js lib/*.js nef.js nef-com.js nef-hub.js
OTHER_FILES = LICENSE.txt package.json upgrade.sh startup.sh nefelus-hub.conf
CONFIGS = hub.conf.in nefelus.conf.in

OBFUSCATOR_PARAMS = --disable-console-output false --self-defending true --string-array true --string-array-encoding base64 --string-array-threshold 0.75 --debug-protection true --debug-protection-interval 0 --control-flow-flattening true --control-flow-flattening-threshold 0.75

VER := $(shell jq -r '.version' package.json)

obfdist: obfdistclean
	mkdir -p obfdist/hub/lib
	for f in $(SRC_FILES); do \
		javascript-obfuscator $$f -o "obfdist/hub/$$f" $(OBFUSCATOR_PARAMS) ; \
	done;
	cp $(CONFIGS) $(OTHER_FILES) obfdist/hub
	( cd obfdist; tar zcf hub-$(VER)-obf.tgz hub ; cp hub-$(VER)-obf.tgz ../.releases)

obfdistclean:
	rm -rf obfdist

lint:
	for f in $(SRC_FILES); do \
		echo "--- $$f ---"; \
		eslint -c ./.eslintrc.json $$f ;\
	done

pack: distclean
	mkdir -p dist/hub/lib
	#npm shrinkwrap
	for f in $(SRC_FILES); do \
                cp $$f dist/hub/$$f; \
        done;
	cp $(JX_FILES) $(CONFIGS) $(OTHER_FILES) dist/hub
	( cd dist; tar zcf hub-$(VER).tgz hub ; cp hub-$(VER).tgz ../.releases)

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
