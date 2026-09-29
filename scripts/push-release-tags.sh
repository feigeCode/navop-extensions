#!/usr/bin/env bash
# 逐个推送 release tag。
#
# 为什么不一次 git push origin tag1 tag2 ...：
# GitHub Actions 对一次 push 里超过 3 个 tag 的场景不产生任何 push 事件
# （refspecs 聚合限制），Release workflow 一个都不会触发。逐个推送即可全部触发。
#
# 用法:
#   scripts/push-release-tags.sh <tag> [tag ...]
#   scripts/push-release-tags.sh dm-v0.1.9 oceanbase-v0.1.13
set -euo pipefail

if [ $# -eq 0 ]; then
  echo "Usage: $0 <tag> [tag ...]" >&2
  exit 2
fi

remote="${PUSH_REMOTE:-origin}"

for tag in "$@"; do
  echo "==> push ${tag}"
  git push "${remote}" "${tag}"
done

echo "All tags pushed one by one:"
for tag in "$@"; do
  echo "  ${tag}"
done
