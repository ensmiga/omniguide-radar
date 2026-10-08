#!/usr/bin/env bash
# OmniGuide - commit and push a data refresh from the scheduled workflow.
#
# WHY THIS IS A FILE.
#
# It was four lines in the workflow: add, commit, push. The push assumed
# main had not moved in the few minutes since checkout. Any code push that
# landed while a refresh was running made it fail at the last step, having
# done all the work - and nothing in a workflow file can be run anywhere
# but on GitHub, so it could not be tried first.
#
# Here it can. It commits whatever changed, and if main has moved it
# replays the data commit on top and tries again. If that replay conflicts,
# someone has already pushed a newer copy of the same files, so this one is
# dropped rather than fought over.
#
# Writes changed=true|false to GITHUB_OUTPUT so the deploy steps can stand
# down when there is nothing new to publish.
set -euo pipefail

out="${GITHUB_OUTPUT:-/dev/null}"
branch="${DATA_BRANCH:-main}"

git config user.name  'omniguide-bot'
git config user.email 'omniguide-bot@users.noreply.github.com'

git add js/wx-grid.js js/gauges.js js/snow.js
if git diff --staged --quiet; then
  echo "nothing new to commit"
  echo "changed=false" >> "$out"
  exit 0
fi

# [skip ci] keeps this commit from triggering another deploy run.
git commit -q -m "data: refresh forecast $(date -u +%Y-%m-%dT%H:%MZ) [skip ci]"

for attempt in 1 2 3 4; do
  if git push origin "HEAD:$branch"; then
    echo "changed=true" >> "$out"
    exit 0
  fi
  echo "push did not go through on attempt $attempt"
  sleep $((attempt * 3))
  # Two different reasons, told apart: the remote could not be reached at
  # all, which is worth another try, or it was reached and has moved.
  if ! git fetch origin "$branch"; then
    echo "could not reach origin"
    continue
  fi
  if ! git rebase "origin/$branch"; then
    git rebase --abort 2>/dev/null || true
    git reset --hard "origin/$branch"
    echo "::warning::$branch already carries a newer copy of the data files; dropping this refresh"
    echo "changed=false" >> "$out"
    exit 0
  fi
done

echo "::error::could not push the refreshed data after 4 attempts"
exit 1
