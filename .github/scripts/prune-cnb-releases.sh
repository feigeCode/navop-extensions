#!/usr/bin/env bash
# 清理 CNB 上 navop-extensions 的历史 Release，控制组织的对象存储用量。
#
# CNB 的对象存储免费额度是 100 GiB，统计「制品、LFS 对象、图片及附件」。扩展
# 每发布一个版本都会在 CNB 上留一份 Release 资产（每版约 8 个平台的安装包），
# 历史版本堆起来会吃掉共享额度，所以每次同步后按下面的规则回收：
#
#   保留 = 扩展市场清单 `manifest.json` 里引用的 release_tag
#        ∪ 每个扩展 id 最新的 CNB_EXTENSION_RETENTION 个版本
#        ∪ 固定 tag `manifest` 本身
#
# 为什么必须先看清单：客户端并不做 tag 发现，它读清单里每个扩展的
# `release_tag` 再拼成 `/-/releases/download/<tag>/<asset>` 去下载
# （见 crates/extension-runtime/src/mirror.rs）。删掉清单正在引用的版本，
# CNB 镜像当场失效 —— 这一步是硬约束，不是优化。
#
# 为什么还要按扩展保留若干版本：清单更新与客户端缓存之间有时间差，客户端可能
# 还拿着上一版清单；另外清单本身也可能被回滚。R2 侧只留当前版本，CNB 作为镜像
# 多留一两个版本成本很低，能兜住这两类窗口。
#
# 只删 Release，不动 git tag：tag 是版本存在的凭证，也是重同步的入口，删掉就
# 无法从 GitHub 重新镜像。
#
# 需要的令牌权限：repo-release:rw（在 https://cnb.cool/profile/token 勾选）。
set -euo pipefail

: "${CNB_REPOSITORY:?CNB_REPOSITORY is required, e.g. navop-dev/navop-extensions}"
: "${CNB_TOKEN:?CNB_TOKEN is required and needs the repo-release:rw scope}"

CNB_API_BASE="${CNB_API_BASE:-https://api.cnb.cool}"
# 每个扩展保留的版本数（含清单引用的那一版）。小于 1 没有意义。
RETENTION="${CNB_EXTENSION_RETENTION:-2}"
DRY_RUN="${CNB_PRUNE_DRY_RUN:-false}"
PAGE_SIZE=100

if ! [[ "${RETENTION}" =~ ^[1-9][0-9]*$ ]]; then
  echo "::error::CNB_EXTENSION_RETENTION must be a positive integer, got '${RETENTION}'"
  exit 1
fi

work_dir="$(mktemp -d)"
trap 'rm -rf "${work_dir}"' EXIT

# CNB 的 API 只在 Accept: application/json（或 application/vnd.cnb.api+json）
# 时返回数据，否则 406。
api_get() {
  local url="$1"
  curl -fsS \
    -H "Authorization: Bearer ${CNB_TOKEN}" \
    -H "Accept: application/json" \
    "${url}"
}

# 列出当前仓库上的全部 Release。CNB 默认每页 10 条，page_size 才生效。
list_releases() {
  local page=1 body count merged="[]"
  while :; do
    if ! body="$(api_get "${CNB_API_BASE}/${CNB_REPOSITORY}/-/releases?page=${page}&page_size=${PAGE_SIZE}")"; then
      return 1
    fi
    if ! count="$(jq 'length' <<<"${body}" 2>/dev/null)"; then
      return 1
    fi
    merged="$(jq -c --argjson chunk "${body}" '. + $chunk' <<<"${merged}")"
    if [ "${count}" -lt "${PAGE_SIZE}" ]; then
      break
    fi
    page=$((page + 1))
    if [ "${page}" -gt 50 ]; then
      break
    fi
  done
  printf '%s' "${merged}"
}

# 拉取固定 tag `manifest` 下的市场清单。清单是判断「哪个版本还在被客户端使用」
# 的唯一依据，取不到就不清理 —— 宁可留着旧版本，也不能靠猜删掉线上在用的包。
fetch_manifest() {
  local release url
  if ! release="$(api_get "${CNB_API_BASE}/${CNB_REPOSITORY}/-/releases/tags/manifest")"; then
    return 1
  fi
  # 优先用公开下载地址，CNB 的 Release 资产对匿名请求开放。
  url="$(jq -r '[.assets[]? | select(.name == "manifest.json")][0].browser_download_url // empty' <<<"${release}")"
  if [ -z "${url}" ]; then
    return 1
  fi
  curl -fsSL --max-time 60 "${url}"
}

echo "Listing releases in ${CNB_REPOSITORY} ..."
if ! releases="$(list_releases)"; then
  echo "::warning::Could not list CNB releases (transient API failure?); skipping prune."
  exit 0
fi

total="$(jq 'length' <<<"${releases}")"
echo "Found ${total} release(s)."

if ! manifest="$(fetch_manifest)"; then
  echo "::error::Could not fetch the marketplace manifest release from CNB; refusing to prune."
  exit 1
fi
if ! jq -e '.extensions | type == "array"' >/dev/null 2>&1 <<<"${manifest}"; then
  echo "::error::Marketplace manifest on CNB is not valid JSON with an extensions array; refusing to prune."
  exit 1
fi

jq -r '.extensions[]? | .release_tag // empty' <<<"${manifest}" | sort -u > "${work_dir}/keep-manifest.txt"
echo "Manifest references $(wc -l < "${work_dir}/keep-manifest.txt" | tr -d ' ') release tag(s)."

jq -r '.[].tag_name // empty' <<<"${releases}" | sort -u > "${work_dir}/all-tags.txt"

# 清单引用了 CNB 上不存在的 tag，说明镜像断档（同步失败或权限问题）。
# 清理本身不做任何补救，但要把它喊出来，否则客户端装扩展会 404。
missing="$(comm -23 "${work_dir}/keep-manifest.txt" "${work_dir}/all-tags.txt")"
if [ -n "${missing}" ]; then
  echo "::warning::Manifest references release(s) missing on CNB: $(tr '\n' ' ' <<<"${missing}")"
fi

# 扩展 tag 形如 `<id>-v<semver>`；固定 tag `manifest` 不是扩展版本。
# 按 id 分组取最新 RETENTION 个版本，保证客户端还能回退到上一版。
: > "${work_dir}/keep-recent.txt"
extensions="$(grep -v '^manifest$' "${work_dir}/all-tags.txt" \
  | sed -nE 's/-v[0-9]+\.[0-9]+\.[0-9]+.*$//p' | sort -u || true)"
for extension in ${extensions}; do
  escaped="$(printf '%s' "${extension}" | sed 's/[][\\.*^$+?(){}|]/\\&/g')"
  grep -E "^${escaped}-v[0-9]+\.[0-9]+\.[0-9]+" "${work_dir}/all-tags.txt" \
    | sort -V | tail -n "${RETENTION}" >> "${work_dir}/keep-recent.txt"
done

{
  cat "${work_dir}/keep-manifest.txt" "${work_dir}/keep-recent.txt"
  echo manifest
} | sort -u > "${work_dir}/keep.txt"

# 保留列表里混进了清单之外的未知 tag 也不用管；这里只算最终要删的。
jq -r --rawfile keep "${work_dir}/keep.txt" \
  '($keep | split("\n") | map(select(length > 0))) as $keep_tags
   | .[] | select((.tag_name // "") as $t | ($keep_tags | index($t)) | not)
   | [ .id, .tag_name, ([.assets[]?.size] | add // 0) ] | @tsv' <<<"${releases}" \
  > "${work_dir}/delete.tsv"

# 清单引用的版本绝不能出现在删除列表里：这条一旦成立，客户端装扩展就会 404。
in_use_deleted="$(cut -f2 "${work_dir}/delete.tsv" | sort | comm -12 - "${work_dir}/keep-manifest.txt" || true)"
if [ -n "${in_use_deleted}" ]; then
  echo "::error::Refusing to prune: release(s) referenced by the live manifest would be deleted: $(tr '\n' ' ' <<<"${in_use_deleted}")"
  exit 1
fi

deletable="$(wc -l < "${work_dir}/delete.tsv" | tr -d ' ')"
if [ "${deletable}" -eq 0 ]; then
  echo "Nothing to prune: all ${total} release(s) are needed."
  exit 0
fi

echo "Keeping $(wc -l < "${work_dir}/keep.txt" | tr -d ' ') tag(s); pruning ${deletable}:"
awk -F'\t' '{ printf "  - %-32s %8.2f MiB\n", $2, $3 / 1048576 }' "${work_dir}/delete.tsv"

if [ "${DRY_RUN}" = "true" ]; then
  echo "CNB_PRUNE_DRY_RUN=true: not deleting anything."
  exit 0
fi

freed=0
deleted=0
while IFS=$'\t' read -r id tag size; do
  if response="$(curl -sS -w '\n%{http_code}' -X DELETE \
    -H "Authorization: Bearer ${CNB_TOKEN}" \
    -H "Accept: application/json" \
    "${CNB_API_BASE}/${CNB_REPOSITORY}/-/releases/${id}")"; then
    code="$(tail -n1 <<<"${response}")"
    case "${code}" in
      200|201|202|204)
        deleted=$((deleted + 1))
        freed=$((freed + size))
        ;;
      404)
        # 并发清理时别的 job 已经删掉，按成功处理。
        ;;
      401|403)
        echo "::error::CNB token lacks release write scope; update the CNB_TOKEN secret. Response: $(sed '$d' <<<"${response}")"
        echo "::error::Create a token with the repo-release:rw scope at https://cnb.cool/profile/token"
        exit 1
        ;;
      *)
        echo "::error::Unexpected HTTP ${code} deleting release ${tag} (id ${id}): $(sed '$d' <<<"${response}")"
        exit 1
        ;;
    esac
  else
    echo "::error::Request to delete release ${tag} (id ${id}) failed"
    exit 1
  fi
done < "${work_dir}/delete.tsv"

printf 'Pruned %d release(s), freed %.2f GiB. Kept %d.\n' \
  "${deleted}" "$(awk -v b="${freed}" 'BEGIN { printf "%.10f", b / 1073741824 }')" \
  "$(wc -l < "${work_dir}/keep.txt" | tr -d ' ')"
