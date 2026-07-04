; Script content → TypeScript
((script_element
  (raw_text) @injection.content)
 (#set! injection.language "typescript")
 (#set! injection.combined))

; Style content → CSS
((style_element
  (raw_text) @injection.content)
 (#set! injection.language "css")
 (#set! injection.combined))

; Svelte expressions → TypeScript
((svelte_raw_text) @injection.content
 (#set! injection.language "typescript")
 (#set! injection.combined))
