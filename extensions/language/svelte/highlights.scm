; Inherited from html
(tag_name) @tag
(erroneous_end_tag_name) @tag
(doctype) @constant
(attribute_name) @attribute
(attribute_value) @string
(comment) @comment

[
  "<"
  ">"
  "</"
  "/>"
] @punctuation.bracket

; Svelte overrides
(raw_text) @none

[
  "as"
  "key"
  "html"
  "snippet"
  "render"
] @keyword

"const" @type.qualifier

[
  "if"
  "else"
  "then"
] @keyword.conditional

"each" @keyword.repeat

[
  "await"
  "then"
] @keyword.coroutine

"catch" @keyword.exception

"debug" @keyword.debug

[
  "{"
  "}"
] @punctuation.bracket

[
  "#"
  ":"
  "/"
  "@"
] @tag.delimiter
