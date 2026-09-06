//! 生成 gpui-shell 类型声明（gpui-kit.d.ts）到指定目录。
//!
//! 与 gpui-shell 宿主使用的 `gpui_shell::type_declarations` 同源，声明由
//! runtime 派发表生成而非手写（见 crates/shell/src/typings.rs）。

use std::path::PathBuf;

fn main() {
    let out_dir: PathBuf = std::env::args()
        .nth(1)
        .expect("usage: gen-gpui-typings <out-dir>")
        .into();
    let declarations = gpui_shell::type_declarations(&gpui_shell::FrozenComponentRegistry::default());
    std::fs::create_dir_all(&out_dir).expect("create out dir");
    let file = out_dir.join("gpui-kit.d.ts");
    std::fs::write(&file, declarations).expect("write gpui-kit.d.ts");
    println!("written {}", file.display());
}
