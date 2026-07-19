#![allow(clippy::result_large_err)]

mod common;
mod legacy;
mod modern;

pub async fn run(variant: &'static str) -> anyhow::Result<()> {
    match variant {
        "modern" => modern::run().await,
        "legacy" => legacy::run().await,
        other => anyhow::bail!("unsupported MongoDB driver variant `{other}`"),
    }
}
