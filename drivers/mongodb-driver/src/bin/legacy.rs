#[tokio::main]
async fn main() -> anyhow::Result<()> {
    mongodb_driver::run("legacy").await
}
