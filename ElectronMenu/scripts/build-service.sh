#!/bin/bash

rm -f service || true
rm -f service.blob || true
node --experimental-sea-config sea-config.json
cp $(command -v node) service
codesign --remove-signature  service
npx postject service NODE_SEA_BLOB service.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --macho-segment-name NODE_SEA
mkdir resources || true
mv service resources
rm -f service.blob
