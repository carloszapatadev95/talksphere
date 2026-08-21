#!/usr/bin/env bash
# Run on YOUR machine (needs browser for Google OAuth + EAS auth)
set -euo pipefail

# 1) Build production AAB (if needed — already built in EAS, reuse it with --id or --latest)
#    The build f8e3cd73 is published on EAS servers. We submit directly:

echo "==> Submitting v1.0.1 (buildId f8e3cd73) to Google Play Internal track"
eas submit --platform android \
  --profile production \
  --id f8e3cd73-1ec9-4ac9-af34-97d6becbc3d1 \
  --wait

echo "==> Submit finished. Verify in Play Console internal track (versionCode 2 / 1.0.1)."
